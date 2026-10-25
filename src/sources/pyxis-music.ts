/**
 * Music from Pyxis. The car is a real Pyxis device that hosts its own playback session
 * (ADR 0003).
 *
 * Setup: claim a device (`auth.device.claim`, token stored on the device), open `/realtime`,
 * and after `welcome` create or re-adopt the car's session (`session.create`,
 * `session.state.get`).
 *
 * Every transport change, from the driver or from a console directive, goes one way:
 * project the new session locally, apply it to the audio element (Play waits for
 * `play()` to resolve), then report it with `session.command.run`. Directives are reported
 * with their `directiveId` as `commandId`, and a repeated directive is dropped before it
 * touches audio. If the renderer fails, nothing is reported and the previous state stays.
 * Commands that cannot reach Pyxis wait in an outbox on the device, in order, with their
 * command ids, and are sent when Pyxis answers again. Position reports are not queued; only
 * the latest one matters.
 *
 * Audio is `{origin}/stream/:trackId`. A media element cannot send the Bearer token; the
 * service worker adds it (src/sw/stream-fetch.ts). Finished tracks are logged with
 * `listen.events.append`, idempotent by event id, from an outbox on the device.
 */
import type { Item, NowPlaying, SourceAdapter, Transport } from "../contract";
import { createEmitter, errorMessage } from "../audio/emitter";
import { type AudioOutput, knownDuration, safeSeconds } from "../audio/output";
import type { KeyValueStorage } from "../audio/shelf-store";
import { randomId } from "./device-id";
import type { PyxisCredentialStore, PyxisCredentials } from "./pyxis-credentials";
import { type PyxisRealtime, type RealtimeStatus, type SocketFactory, createPyxisRealtime } from "./pyxis-realtime";
import {
  type PyxisDirective,
  type PyxisLibraryAlbum,
  type PyxisListenEvent,
  type PyxisOperations,
  type PyxisRpc,
  PyxisRpcError,
  type PyxisSession,
  type PyxisSessionCommand,
  isPyxisSession,
} from "./pyxis-rpc";
import { applySessionCommand } from "./pyxis-session";

export const PYXIS_DEVICE_NAME = "Vela";
const SESSION_KEY = "vela.pyxis.session";
const OUTBOX_KEY = "vela.pyxis.outbox";
const LISTENS_KEY = "vela.pyxis.listens";
const TRACKS_KEY = "vela.pyxis.tracks";
const PINNED_KEY = "vela.pyxis.pinned";
const KEPT_TRACKS = 500;
const SEEN_DIRECTIVES = 200;
const ALBUMS_FRESH_MS = 10 * 60 * 1000;

interface TrackInfo {
  readonly item: Item;
  readonly sourcePluginId?: string;
  readonly albumId?: string;
}

interface PendingCommand {
  readonly commandId: string;
  readonly command: PyxisSessionCommand;
}

export interface OfflineTrack {
  readonly url: string;
  readonly label: string;
}

export interface PyxisMusicOptions {
  readonly rpc: PyxisRpc;
  readonly origin: string;
  readonly output: AudioOutput;
  readonly credentials: PyxisCredentialStore;
  readonly connect: SocketFactory;
  readonly storage: KeyValueStorage;
  readonly deviceName?: string;
  readonly newId?: () => string;
  readonly onRealtimeStatus?: (status: RealtimeStatus) => void;
}

export interface PyxisMusicAdapter extends SourceAdapter {
  /** Claim the device if needed and start hosting. Safe to call more than once. */
  start(): Promise<void>;
  /** The car's session as it last knew it. */
  readonly session: PyxisSession | undefined;
  readonly realtime: RealtimeStatus;
  /** Commands and listens waiting for Pyxis. */
  readonly pending: { readonly commands: number; readonly listens: number };
  /** Send queued commands and listens now. */
  flush(): Promise<void>;
  albums(): Promise<readonly PyxisLibraryAlbum[]>;
  pinned(): ReadonlySet<string>;
  setPinned(albumId: string, pinned: boolean): void;
  /** Every track of every pinned album, for offline downloads. */
  offlineTracks(): Promise<readonly OfflineTrack[]>;
  /** The URL the player requests for a track. */
  streamUrl(trackId: string): string;
}

function readJson<T>(storage: KeyValueStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJson(storage: KeyValueStorage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Vela could not save ${key}`, error);
  }
}

const isRetryable = (error: unknown) => error instanceof PyxisRpcError && error.retryable;

export function createPyxisMusic(options: PyxisMusicOptions): PyxisMusicAdapter {
  const { rpc, origin, output, credentials, storage } = options;
  const element = output.element;
  const newId = options.newId ?? randomId;
  const changes = createEmitter<NowPlaying | undefined>();

  const storedSession = readJson<unknown>(storage, SESSION_KEY, undefined);
  let session: PyxisSession | undefined = isPyxisSession(storedSession) ? storedSession : undefined;
  let outbox = readJson<PendingCommand[]>(storage, OUTBOX_KEY, []);
  let listens = readJson<PyxisListenEvent[]>(storage, LISTENS_KEY, []);
  const tracks = new Map<string, TrackInfo>(readJson<[string, TrackInfo][]>(storage, TRACKS_KEY, []));
  const pinnedAlbums = new Set<string>(readJson<string[]>(storage, PINNED_KEY, []));
  const seen: string[] = [];

  let creds: PyxisCredentials | undefined;
  let starting: Promise<void> | undefined;
  let sessionReady: Promise<void> | undefined;
  let welcomed: (() => void) | undefined;
  let albumsCache: { at: number; albums: readonly PyxisLibraryAlbum[] } | undefined;
  let loadedTrack: string | undefined;
  let pendingSeekSec: number | undefined;
  let pendingPlay = false;
  let failure: string | undefined;
  let flushing: Promise<void> | undefined;
  let lane: Promise<unknown> = Promise.resolve();
  let disposed = false;

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = lane.then(task);
    lane = result.catch(() => undefined);
    return result;
  };

  const streamUrl = (trackId: string) => `${origin}/stream/${encodeURIComponent(trackId)}`;

  const saveSession = () => writeJson(storage, SESSION_KEY, session);
  const saveOutbox = () => writeJson(storage, OUTBOX_KEY, outbox);
  const saveListens = () => writeJson(storage, LISTENS_KEY, listens);
  const saveTracks = () => writeJson(storage, TRACKS_KEY, [...tracks.entries()].slice(-KEPT_TRACKS));

  const remember = (info: TrackInfo) => {
    tracks.delete(info.item.id);
    tracks.set(info.item.id, info);
  };

  const itemFor = (trackId: string): Item =>
    tracks.get(trackId)?.item ?? { source: "music", id: trackId, title: "Unknown track", by: "" };

  const transport = (): Transport => {
    if (failure !== undefined) return "error";
    if (pendingPlay) return "loading";
    if (!element.paused) return "playing";
    if (session?.transport === "stopped" || session?.transport === "ended") return "stopped";
    return "paused";
  };

  const state = (): NowPlaying | undefined => {
    const trackId = session?.currentTrackId;
    if (trackId === undefined) return undefined;
    const now = transport();
    return {
      item: itemFor(trackId),
      transport: now,
      positionSec: pendingSeekSec ?? safeSeconds(element.currentTime),
      ...(now === "error" && failure !== undefined ? { error: failure } : {}),
    };
  };
  const publish = () => changes.emit(state());

  async function token(): Promise<string> {
    if (creds === undefined) await start();
    if (creds === undefined) throw new Error("Pyxis has not given this car a device token");
    return creds.token;
  }

  async function claim(): Promise<PyxisCredentials> {
    const outcome = await rpc.call("auth.device.claim", { name: options.deviceName ?? PYXIS_DEVICE_NAME });
    if (outcome.status === "pairingRequired") {
      throw new Error("Pyxis needs this car to be paired with a code from a trusted device");
    }
    if (outcome.status !== "ready") throw new PyxisRpcError(outcome.value.message, outcome.value.retryable, outcome.value.code);
    const claimed: PyxisCredentials = {
      token: outcome.value.bearerToken,
      deviceId: outcome.value.device.id,
      accountId: outcome.value.account.id,
    };
    await credentials.write(claimed);
    return claimed;
  }

  async function ensureSession(): Promise<void> {
    const current = creds;
    if (current === undefined) return;
    if (current.sessionId !== undefined) {
      const outcome = await rpc.call("session.state.get", { sessionId: current.sessionId }, current.token);
      if (outcome.status === "ready" && outcome.value.hostDeviceId === current.deviceId) {
        // Pending local intent is newer than the core's copy; the outbox brings the core up.
        if (outbox.length === 0 || session === undefined) {
          session = outcome.value;
          saveSession();
        }
        await flush();
        publish();
        return;
      }
      if (outcome.status === "unavailable") throw new PyxisRpcError(outcome.value.message, outcome.value.retryable);
    }
    const created = await rpc.call("session.create", { name: options.deviceName ?? PYXIS_DEVICE_NAME }, current.token);
    if (created.status === "notDevice") throw new Error("Pyxis refused to let this car host a session");
    if (created.status !== "ready") throw new PyxisRpcError(created.value.message, created.value.retryable);
    creds = { ...current, sessionId: created.value.id };
    await credentials.write(creds);
    outbox = [];
    saveOutbox();
    session = created.value;
    saveSession();
    publish();
  }

  const realtime: PyxisRealtime = createPyxisRealtime({
    origin,
    connect: options.connect,
    token,
    onWelcome: () => {
      welcomed?.();
      welcomed = undefined;
      // The car counts as reachable now; (re)adopt the session over RPC. A missed-event
      // gap needs nothing more: the car is the host and owns its session's truth.
      sessionReady = ensureSession().catch((error: unknown) => {
        console.warn("Vela could not set up its Pyxis session", error);
      });
    },
    onDirective: (directive) => {
      void applyDirective(directive).catch((error: unknown) => {
        console.warn("Vela could not apply a Pyxis console command", error);
      });
    },
    ...(options.onRealtimeStatus === undefined ? {} : { onStatus: options.onRealtimeStatus }),
  });

  function start(): Promise<void> {
    if (starting !== undefined) return starting;
    starting = (async () => {
      creds = (await credentials.read()) ?? (await claim());
      const welcome = new Promise<void>((resolve) => {
        welcomed = resolve;
      });
      realtime.start();
      // Wait briefly for the session so the first command has one; offline, go on with the
      // stored session snapshot.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        welcome.then(() => sessionReady),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 4000);
        }),
      ]);
      clearTimeout(timer);
    })().catch((error: unknown) => {
      starting = undefined;
      throw error;
    });
    return starting;
  }

  // Renderer: make the element match a session.

  function loadTrack(trackId: string | undefined, positionMs: number): void {
    if (trackId === loadedTrack) return;
    loadedTrack = trackId;
    failure = undefined;
    if (trackId === undefined) {
      element.pause();
      element.removeAttribute("src");
      pendingSeekSec = undefined;
      return;
    }
    pendingSeekSec = positionMs / 1000;
    element.src = streamUrl(trackId);
  }

  async function render(target: PyxisSession, command: PyxisSessionCommand): Promise<void> {
    output.setVolume(target.volume / 100);
    if (command._tag === "transport.trackEnded" && target.currentTrackId === loadedTrack && target.transport === "playing") {
      element.currentTime = 0;
    }
    loadTrack(target.currentTrackId, target.positionMs);
    if (command._tag === "transport.seek") {
      if (pendingSeekSec !== undefined) pendingSeekSec = target.positionMs / 1000;
      else element.currentTime = target.positionMs / 1000;
    }
    if (command._tag === "transport.stop") element.currentTime = 0;
    if (target.transport === "playing") {
      if (!element.paused) return;
      pendingPlay = true;
      publish();
      try {
        await element.play();
      } finally {
        pendingPlay = false;
      }
    } else {
      element.pause();
    }
  }

  // Reporting.

  async function report(entry: PendingCommand): Promise<void> {
    const sessionId = creds?.sessionId;
    if (creds === undefined || sessionId === undefined) {
      if (entry.command._tag !== "position.report") outbox.push(entry);
      saveOutbox();
      return;
    }
    if (outbox.length > 0) {
      if (entry.command._tag !== "position.report") {
        outbox.push(entry);
        saveOutbox();
      }
      await flush();
      return;
    }
    try {
      const outcome = await rpc.call(
        "session.command.run",
        { sessionId, commandId: entry.commandId, command: entry.command },
        creds.token,
      );
      settle(outcome);
    } catch (error) {
      if (!isRetryable(error)) throw error;
      if (entry.command._tag !== "position.report") {
        outbox.push(entry);
        saveOutbox();
      }
    }
  }

  function settle(outcome: PyxisOperations["session.command.run"]["outcome"]): void {
    if (outcome.status === "applied" && isPyxisSession(outcome.value)) {
      session = outcome.value;
      saveSession();
      return;
    }
    if (outcome.status === "unavailable") {
      throw new PyxisRpcError("Pyxis could not store the command", true);
    }
    console.warn(`Pyxis did not apply a session command: ${outcome.status}`);
    if (outcome.status === "unknownSession" || outcome.status === "notHost") {
      // The session is gone or belongs to another host now; make a new one at next welcome.
      if (creds !== undefined) {
        const { sessionId: _old, ...rest } = creds;
        creds = rest;
        void credentials.write(rest);
      }
    }
  }

  function flush(): Promise<void> {
    if (flushing !== undefined) return flushing;
    flushing = (async () => {
      try {
        const current = creds;
        if (current?.sessionId !== undefined) {
          while (outbox.length > 0) {
            const entry = outbox[0];
            if (entry === undefined) break;
            try {
              const outcome = await rpc.call(
                "session.command.run",
                { sessionId: current.sessionId, commandId: entry.commandId, command: entry.command },
                current.token,
              );
              outbox.shift();
              saveOutbox();
              try {
                settle(outcome);
              } catch {
                outbox.unshift(entry);
                saveOutbox();
                break;
              }
            } catch (error) {
              if (isRetryable(error)) break;
              outbox.shift();
              saveOutbox();
            }
          }
        }
        await flushListens();
      } finally {
        flushing = undefined;
      }
    })();
    return flushing;
  }

  async function flushListens(): Promise<void> {
    if (listens.length === 0 || creds === undefined) return;
    const batch = listens.slice(0, 50);
    try {
      const outcome = await rpc.call("listen.events.append", { events: batch }, creds.token);
      if (outcome.status === "unavailable" && outcome.value.retryable) return;
      if (outcome.status !== "ready") console.warn(`Pyxis refused listen events: ${outcome.status}`);
      const sent = new Set(batch.map((event) => event.id));
      listens = listens.filter((event) => !sent.has(event.id));
      saveListens();
    } catch (error) {
      if (!isRetryable(error)) {
        console.warn("Pyxis refused listen events", error);
      }
    }
  }

  /** Project, render, then report. Throws (and reports nothing) when the renderer fails. */
  async function run(command: PyxisSessionCommand, commandId = newId()): Promise<void> {
    const before = session;
    if (before === undefined) throw new Error("Music is not set up yet: Pyxis has not been reached");
    const next = applySessionCommand(before, command);
    try {
      await render(next, command);
    } catch (error) {
      // Failures preserve prior truth: put the renderer back and report nothing.
      loadTrack(before.currentTrackId, before.positionMs);
      element.pause();
      failure = `Music could not play: ${errorMessage(error)}`;
      publish();
      throw error;
    }
    session = next;
    saveSession();
    publish();
    await report({ commandId, command });
    publish();
  }

  function rememberSeen(directiveId: string): boolean {
    if (seen.includes(directiveId)) return false;
    seen.push(directiveId);
    if (seen.length > SEEN_DIRECTIVES) seen.shift();
    return true;
  }

  function applyDirective(directive: PyxisDirective): Promise<void> {
    return enqueue(async () => {
      if (directive.sessionId !== creds?.sessionId) return;
      if (!rememberSeen(directive.directiveId)) return;
      const command = directive.command;
      if (command._tag === "position.report" || command._tag === "transport.trackEnded") return;
      if (
        command._tag === "transport.seek" &&
        directive.expectedRevision !== undefined &&
        session !== undefined &&
        directive.expectedRevision !== session.revision
      ) {
        return;
      }
      if (command._tag === "transport.pause" && session?.transport !== "playing") return;
      await run(command, directive.directiveId);
    });
  }

  // Element events.

  const handlers = {
    loadedmetadata: () => {
      if (pendingSeekSec !== undefined) {
        const seek = pendingSeekSec;
        pendingSeekSec = undefined;
        if (seek > 0) element.currentTime = seek;
      }
      const trackId = loadedTrack;
      const duration = knownDuration(element);
      if (trackId !== undefined && duration !== undefined) {
        const info = tracks.get(trackId);
        if (info !== undefined && info.item.durationSec === undefined) {
          remember({ ...info, item: { ...info.item, durationSec: Math.round(duration) } });
        }
        // Seek needs the core to know the duration.
        void enqueue(() => syncPosition()).catch(() => undefined);
      }
      publish();
    },
    timeupdate: () => publish(),
    play: () => publish(),
    pause: () => publish(),
    ended: () => {
      const trackId = loadedTrack;
      const sessionId = creds?.sessionId;
      const deviceId = creds?.deviceId;
      if (trackId !== undefined && deviceId !== undefined) {
        const info = tracks.get(trackId);
        const playedMs = Math.min(0xffffffff, Math.round(safeSeconds(element.duration) * 1000));
        listens.push({
          id: newId(),
          trackId,
          deviceId,
          ...(info?.albumId === undefined ? {} : { albumId: info.albumId }),
          ...(info?.sourcePluginId === undefined ? {} : { sourcePluginId: info.sourcePluginId }),
          listenedAt: new Date().toISOString(),
          ...(playedMs > 0 ? { playedMs } : {}),
          completed: true,
          context: "queue",
          ...(sessionId === undefined ? {} : { contextId: sessionId }),
        });
        saveListens();
      }
      void enqueue(async () => {
        if (session?.transport !== "playing") return;
        await run({ _tag: "transport.trackEnded", payload: {} });
      }).catch((error: unknown) => console.warn("Vela could not move to the next track", error));
      void flushListens();
    },
    error: () => {
      if (loadedTrack === undefined || element.src === "") return;
      failure = `Music could not play: ${element.error?.message ?? "the stream did not load"}`;
      publish();
      // Audio failed after Playing was reported: report Pause so consoles do not show
      // silent playback.
      void enqueue(async () => {
        if (session?.transport === "playing") {
          const next = applySessionCommand(session, { _tag: "transport.pause", payload: {} });
          session = next;
          saveSession();
          await report({ commandId: newId(), command: { _tag: "transport.pause", payload: {} } });
        }
      }).catch(() => undefined);
    },
  } as const;
  for (const [type, handler] of Object.entries(handlers)) element.addEventListener(type as keyof typeof handlers, handler);

  async function albums(): Promise<readonly PyxisLibraryAlbum[]> {
    if (albumsCache !== undefined && Date.now() - albumsCache.at < ALBUMS_FRESH_MS) return albumsCache.albums;
    const outcome = await rpc.call("library.albums.list", {}, await token());
    if (outcome.status !== "ready") throw new PyxisRpcError(outcome.value.message, outcome.value.retryable);
    for (const album of outcome.value) {
      for (const track of album.tracks) {
        const art = track.artworkUrl ?? album.artworkUrl;
        remember({
          albumId: album.id,
          item: {
            source: "music",
            id: track.id,
            title: track.title,
            by: track.artist,
            from: album.title,
            ...(art === undefined ? {} : { artUrl: art }),
            ...(track.durationMs === undefined ? {} : { durationSec: Math.round(track.durationMs / 1000) }),
          },
        });
      }
    }
    saveTracks();
    albumsCache = { at: Date.now(), albums: outcome.value };
    return outcome.value;
  }

  async function syncPosition(): Promise<void> {
    if (session?.currentTrackId === undefined || loadedTrack !== session.currentTrackId) return;
    const duration = knownDuration(element);
    const positionMs = Math.round(safeSeconds(element.currentTime) * 1000);
    const durationMs = duration === undefined ? undefined : Math.min(0xffffffff, Math.round(duration * 1000));
    if (durationMs !== undefined && positionMs > durationMs) return;
    const command: PyxisSessionCommand = {
      _tag: "position.report",
      payload: { positionMs, ...(durationMs === undefined ? {} : { durationMs }) },
    };
    session = applySessionCommand(session, command);
    saveSession();
    await report({ commandId: newId(), command });
  }

  async function step(delta: 1 | -1): Promise<void> {
    if (session?.cursor === undefined) return;
    const wasPlaying = session.transport === "playing";
    const index = session.cursor + delta;
    if (index < 0) {
      if (session.durationMs !== undefined) await run({ _tag: "transport.seek", payload: { positionMs: 0 } });
      return;
    }
    if (index >= session.queue.length) return;
    await run({ _tag: "cursor.jump", payload: { index } });
    if (wasPlaying) await run({ _tag: "transport.play", payload: {} });
  }

  const quietly = (task: Promise<void>, what: string) => {
    task.catch((error: unknown) => console.warn(`Vela could not ${what}`, error));
  };

  return {
    source: "music",
    start,
    get session() {
      return session;
    },
    get realtime() {
      return realtime.status;
    },
    get pending() {
      return { commands: outbox.length, listens: listens.length };
    },
    async load(item) {
      await start().catch((error: unknown) => {
        if (session === undefined) throw error;
      });
      if (!tracks.has(item.id)) remember({ item });
      await albums().catch(() => undefined);
      await enqueue(async () => {
        if (session === undefined) throw new Error("Music is not set up yet: Pyxis has not been reached");
        if (session.currentTrackId === item.id) {
          failure = undefined;
          loadTrack(item.id, session.positionMs);
          publish();
          return;
        }
        const info = tracks.get(item.id);
        const album = info?.albumId === undefined ? undefined : albumsCache?.albums.find((entry) => entry.id === info.albumId);
        const trackIds = album === undefined ? [item.id] : album.tracks.map((track) => track.id);
        const index = Math.max(0, trackIds.indexOf(item.id));
        await run({ _tag: "queue.clear", payload: {} });
        await run({ _tag: "queue.add", payload: { trackIds } });
        await run({ _tag: "cursor.jump", payload: { index } });
        saveTracks();
      });
    },
    play: () =>
      enqueue(async () => {
        if (session === undefined || session.currentTrackId === undefined) return;
        if (session.transport === "playing" && !element.paused) return;
        failure = undefined;
        await run({ _tag: "transport.play", payload: {} });
      }),
    pause() {
      // Silence at once; the report follows in order.
      element.pause();
      quietly(
        enqueue(async () => {
          if (session?.transport === "playing") await run({ _tag: "transport.pause", payload: {} });
        }),
        "pause Music",
      );
    },
    seek(positionSec) {
      quietly(
        enqueue(async () => {
          if (session?.durationMs === undefined) return;
          const positionMs = Math.min(session.durationMs, Math.max(0, Math.round(positionSec * 1000)));
          await run({ _tag: "transport.seek", payload: { positionMs } });
        }),
        "seek",
      );
    },
    back: () => quietly(enqueue(() => step(-1)), "go to the previous track"),
    forward: () => quietly(enqueue(() => step(1)), "go to the next track"),
    syncPosition: () => enqueue(syncPosition),
    flush,
    async lastItem() {
      const trackId = session?.currentTrackId;
      return trackId === undefined ? undefined : itemFor(trackId);
    },
    async search(query) {
      const outcome = await rpc.call("source.search.run", { query, limit: 25 }, await token());
      if (outcome.status === "noSources") return [];
      if (outcome.status !== "ready") throw new PyxisRpcError(outcome.value.message, outcome.value.retryable);
      const items = outcome.value.tracks.map((track): Item => {
        const item: Item = {
          source: "music",
          id: track.id,
          title: track.title,
          by: track.artist,
          ...(track.album === undefined ? {} : { from: track.album }),
          ...(track.artworkUrl === undefined ? {} : { artUrl: track.artworkUrl }),
          ...(track.durationMs === undefined ? {} : { durationSec: Math.round(track.durationMs / 1000) }),
        };
        remember({ item, sourcePluginId: track.sourcePluginId });
        return item;
      });
      saveTracks();
      return items;
    },
    subscribe: (listener) => changes.subscribe(listener),
    albums,
    pinned: () => pinnedAlbums,
    setPinned(albumId, pin) {
      if (pin) pinnedAlbums.add(albumId);
      else pinnedAlbums.delete(albumId);
      writeJson(storage, PINNED_KEY, [...pinnedAlbums]);
    },
    async offlineTracks() {
      if (pinnedAlbums.size === 0) return [];
      const library = await albums();
      return library
        .filter((album) => pinnedAlbums.has(album.id))
        .flatMap((album) =>
          album.tracks.map((track) => ({ url: streamUrl(track.id), label: `${album.title}: ${track.title}` })),
        );
    },
    streamUrl,
    dispose() {
      if (disposed) return;
      disposed = true;
      realtime.stop();
      for (const [type, handler] of Object.entries(handlers)) element.removeEventListener(type as keyof typeof handlers, handler);
      element.pause();
      changes.clear();
    },
  };
}
