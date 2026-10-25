/**
 * Podcasts from Ossicle. YouTube channels in Ossicle are Podcasts too, played as audio only:
 * Vela always plays `audioPath` and never `videoPath`.
 *
 * Audio is a plain media element on `{origin}{audioPath}` (`/audio/:episodeId?v=…`); Ossicle
 * needs no auth for it. Positions are revisioned: Vela keeps the last position per episode on
 * the device, writes it with `baseRevision` and `deviceId`, and settles conflicts with the
 * rule in position-conflict.ts. Positions written while offline stay on the device and are
 * written at the next sync.
 */
import type { Item, NowPlaying, SourceAdapter, Transport } from "../contract";
import { createEmitter, errorMessage } from "../audio/emitter";
import { type AudioOutput, knownDuration, safeSeconds } from "../audio/output";
import type { KeyValueStorage } from "../audio/shelf-store";
import type { OfflineEpisode, PodcastCandidates } from "../sw/download-plan";
import {
  type OssicleEpisode,
  type OssiclePodcast,
  type OssiclePosition,
  type OssicleQueueEntry,
  type OssicleRpc,
  OssicleRpcError,
  arrayOf,
  isOssicleEpisode,
  isOssiclePodcast,
  isOssiclePosition,
  isRecord,
  readyValue,
} from "./ossicle-rpc";
import { MAX_CONFLICT_ROUNDS, resolvePositionConflict } from "./position-conflict";

export const TALK_BACK_SEC = 15;
export const TALK_FORWARD_SEC = 30;
export const POSITIONS_STORAGE_KEY = "vela.ossicle.positions";
const CATALOG_WINDOW = 500;
const CATALOG_FRESH_MS = 5 * 60 * 1000;
const KEPT_POSITIONS = 300;

/** The device's view of one episode's position. `dirty` means not yet written to Ossicle. */
export interface LocalPosition {
  readonly seconds: number;
  readonly revision?: number;
  readonly dirty: boolean;
  readonly updatedAt: number;
}

export interface OssiclePodcastsOptions {
  readonly rpc: OssicleRpc;
  readonly origin: string;
  readonly output: AudioOutput;
  readonly storage: KeyValueStorage;
  readonly deviceId: string;
}

export interface OssiclePodcastsAdapter extends SourceAdapter {
  /** The queue and recent episodes, for the offline download rules. */
  offlineCandidates(): Promise<PodcastCandidates>;
  /** The device's stored position for an episode, if any. */
  localPosition(episodeId: string): LocalPosition | undefined;
}

const isQueueEntry = (value: unknown): value is OssicleQueueEntry =>
  isRecord(value) && isOssicleEpisode(value.episode) && typeof value.podcastTitle === "string";

const isEpisodeWindow = (value: unknown): value is { episodes: readonly OssicleEpisode[] } =>
  isRecord(value) && arrayOf(isOssicleEpisode)(value.episodes);

function readPositions(storage: KeyValueStorage): Record<string, LocalPosition> {
  try {
    const value: unknown = JSON.parse(storage.getItem(POSITIONS_STORAGE_KEY) ?? "{}");
    if (!isRecord(value)) return {};
    const out: Record<string, LocalPosition> = {};
    for (const [id, entry] of Object.entries(value)) {
      if (!isRecord(entry) || typeof entry.seconds !== "number" || typeof entry.dirty !== "boolean") continue;
      out[id] = {
        seconds: entry.seconds,
        dirty: entry.dirty,
        updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
        ...(typeof entry.revision === "number" ? { revision: entry.revision } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function createOssiclePodcasts(options: OssiclePodcastsOptions): OssiclePodcastsAdapter {
  const { rpc, origin, output, storage, deviceId } = options;
  const element = output.element;
  const changes = createEmitter<NowPlaying | undefined>();

  const positions = readPositions(storage);
  const episodes = new Map<string, OssicleEpisode>();
  const podcasts = new Map<string, OssiclePodcast>();
  let catalogAt = 0;

  let current: Item | undefined;
  let transport: Transport = "stopped";
  let failure: string | undefined;
  let pendingSeek: number | undefined;
  let loadToken = 0;
  let syncing: Promise<void> | undefined;

  const savePositions = () => {
    const entries = Object.entries(positions).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    const kept = Object.fromEntries(entries.slice(0, KEPT_POSITIONS));
    try {
      storage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(kept));
    } catch (error) {
      console.warn("Vela could not save podcast positions", error);
    }
  };

  const setLocal = (id: string, next: Omit<LocalPosition, "updatedAt">) => {
    positions[id] = { ...next, updatedAt: Date.now() };
    savePositions();
  };

  const positionSec = () => pendingSeek ?? safeSeconds(element.currentTime);

  const state = (): NowPlaying | undefined =>
    current === undefined
      ? undefined
      : {
          item: current,
          transport,
          positionSec: positionSec(),
          ...(transport === "error" && failure !== undefined ? { error: failure } : {}),
        };
  const publish = () => changes.emit(state());

  const itemFor = (episode: OssicleEpisode, podcastTitle?: string, coverPath?: string): Item => {
    const podcast = podcasts.get(episode.podcastId);
    const cover = coverPath ?? podcast?.coverPath;
    const duration = episode.durationSeconds;
    return {
      source: "podcasts",
      id: episode.id,
      title: episode.title,
      by: podcastTitle ?? podcast?.title ?? "Podcast",
      ...(cover === undefined ? {} : { artUrl: `${origin}${cover}` }),
      ...(duration === undefined || duration <= 0 ? {} : { durationSec: duration }),
    };
  };

  async function refreshCatalog(force = false): Promise<void> {
    if (!force && Date.now() - catalogAt < CATALOG_FRESH_MS && episodes.size > 0) return;
    const [library, window] = await Promise.all([
      rpc.call("library.snapshot", {}),
      rpc.call("library.episodes", { limit: CATALOG_WINDOW }),
    ]);
    for (const podcast of readyValue("library.snapshot", library, arrayOf(isOssiclePodcast))) {
      podcasts.set(podcast.id, podcast);
    }
    for (const episode of readyValue("library.episodes", window, isEpisodeWindow).episodes) {
      episodes.set(episode.id, episode);
    }
    catalogAt = Date.now();
  }

  async function serverPositions(): Promise<readonly OssiclePosition[]> {
    return readyValue("position.list", await rpc.call("position.list", {}), arrayOf(isOssiclePosition));
  }

  const recordPosition = () => {
    if (current === undefined || pendingSeek !== undefined) return;
    const seconds = Math.floor(safeSeconds(element.currentTime));
    const local = positions[current.id];
    if (local?.seconds === seconds) return;
    positions[current.id] = {
      seconds,
      dirty: true,
      updatedAt: Date.now(),
      ...(local?.revision === undefined ? {} : { revision: local.revision }),
    };
  };

  const moveTo = (seconds: number) => {
    const duration = knownDuration(element) ?? current?.durationSec;
    const target = Math.max(0, duration === undefined ? seconds : Math.min(seconds, Math.max(0, duration - 1)));
    if (pendingSeek !== undefined || knownDuration(element) === undefined) pendingSeek = target;
    else element.currentTime = target;
  };

  const handlers = {
    loadedmetadata: () => {
      if (current !== undefined && current.durationSec === undefined) {
        const duration = knownDuration(element);
        if (duration !== undefined) current = { ...current, durationSec: Math.round(duration) };
      }
      if (pendingSeek !== undefined) {
        const seek = pendingSeek;
        pendingSeek = undefined;
        element.currentTime = seek;
      }
      publish();
    },
    timeupdate: () => {
      recordPosition();
      publish();
    },
    play: () => {
      transport = "playing";
      publish();
    },
    pause: () => {
      if (transport === "playing" || transport === "loading") transport = "paused";
      recordPosition();
      savePositions();
      publish();
    },
    ended: () => {
      transport = "stopped";
      recordPosition();
      savePositions();
      publish();
      const id = current?.id;
      if (id === undefined) return;
      void (async () => {
        await syncPosition().catch(() => undefined);
        await rpc.call("position.markPlayed", { episodeId: id, played: true, deviceId }).catch(() => undefined);
      })();
    },
    error: () => {
      if (current === undefined || element.src === "") return;
      transport = "error";
      failure = `This episode could not play: ${element.error?.message ?? "the audio did not load"}`;
      publish();
    },
  } as const;
  for (const [type, handler] of Object.entries(handlers)) {
    element.addEventListener(type as keyof typeof handlers, handler);
  }

  async function load(item: Item): Promise<void> {
    const mine = ++loadToken;
    element.pause();
    current = item;
    transport = "loading";
    failure = undefined;
    pendingSeek = 0;
    publish();

    let episode = episodes.get(item.id);
    if (episode === undefined) {
      await refreshCatalog(true).catch(() => undefined);
      episode = episodes.get(item.id);
    }
    let remote: OssiclePosition | undefined;
    try {
      remote = (await serverPositions()).find((position) => position.episodeId === item.id);
    } catch {
      remote = episode?.position;
    }
    if (mine !== loadToken) return;

    // Unsynced listening done in the car starts where the car left off; the sync below
    // settles it against Ossicle with the conflict rule. Otherwise Ossicle's position wins.
    const local = positions[item.id];
    let start = local?.seconds ?? 0;
    if (local?.dirty !== true && remote !== undefined) {
      start = remote.played ? 0 : remote.seconds;
      setLocal(item.id, { seconds: remote.seconds, revision: remote.revision, dirty: false });
    }

    if (episode !== undefined) current = itemFor(episode);
    const path = episode?.audioPath ?? `/audio/${encodeURIComponent(item.id)}`;
    pendingSeek = start;
    transport = "paused";
    element.src = `${origin}${path}`;
    publish();
    if (local?.dirty === true) void syncPosition().catch(() => undefined);
  }

  async function play(): Promise<void> {
    if (current === undefined) return;
    try {
      await element.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      transport = "error";
      failure = `This episode could not play: ${errorMessage(error)}`;
      publish();
      throw error;
    }
  }

  async function writePosition(id: string): Promise<void> {
    const local = positions[id];
    if (local === undefined || !local.dirty) return;
    const seconds = local.seconds;
    let baseRevision = local.revision;
    let force = false;
    for (let round = 0; round < MAX_CONFLICT_ROUNDS; round += 1) {
      const outcome = await rpc.call("position.write", {
        episodeId: id,
        seconds,
        ...(baseRevision === undefined ? {} : { baseRevision }),
        deviceId,
        force,
      });
      if (outcome.status === "accepted") {
        if (!isOssiclePosition(outcome.value)) throw new OssicleRpcError("position.write returned an invalid position", false);
        const latest = positions[id];
        // Listening may have moved on while the write was in flight; keep it dirty if so.
        setLocal(id, {
          seconds: latest?.seconds ?? seconds,
          revision: outcome.value.revision,
          dirty: latest !== undefined && latest.seconds !== seconds,
        });
        return;
      }
      if (outcome.status === "conflict") {
        const theirs = outcome.value.theirs;
        if (!isOssiclePosition(theirs)) throw new OssicleRpcError("position.write returned an invalid conflict", false);
        const latestSeconds = positions[id]?.seconds ?? seconds;
        if (resolvePositionConflict(theirs.seconds, latestSeconds).kind === "keepMine") {
          baseRevision = theirs.revision;
          force = true;
          continue;
        }
        setLocal(id, { seconds: theirs.seconds, revision: theirs.revision, dirty: false });
        if (current?.id === id) {
          moveTo(theirs.seconds);
          publish();
        }
        return;
      }
      if (outcome.status === "unknownEpisode") {
        // Ossicle no longer has it. Nothing to sync; keep the local position for this play.
        setLocal(id, { seconds, dirty: false });
        return;
      }
      throw new OssicleRpcError(`Ossicle could not store the position: ${outcome.value.message}`, true);
    }
  }

  function syncPosition(): Promise<void> {
    if (syncing !== undefined) return syncing;
    recordPosition();
    const dirty = Object.entries(positions)
      .filter(([, position]) => position.dirty)
      .map(([id]) => id);
    syncing = (async () => {
      try {
        for (const id of dirty) await writePosition(id);
      } finally {
        syncing = undefined;
      }
    })();
    return syncing;
  }

  return {
    source: "podcasts",
    load,
    play,
    pause: () => element.pause(),
    seek(positionSecValue) {
      if (current === undefined) return;
      moveTo(positionSecValue);
      recordPosition();
      publish();
    },
    back() {
      if (current === undefined) return;
      moveTo(positionSec() - TALK_BACK_SEC);
      recordPosition();
      publish();
    },
    forward() {
      if (current === undefined) return;
      moveTo(positionSec() + TALK_FORWARD_SEC);
      recordPosition();
      publish();
    },
    syncPosition,
    async lastItem() {
      const list = await serverPositions();
      const newest = [...list].filter((position) => !position.played).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (newest === undefined) return undefined;
      await refreshCatalog();
      const episode = episodes.get(newest.episodeId);
      return episode === undefined ? undefined : itemFor(episode);
    },
    async search(query) {
      await refreshCatalog();
      const needle = query.trim().toLowerCase();
      const all = [...episodes.values()];
      const hits =
        needle === ""
          ? all
          : all.filter(
              (episode) =>
                episode.title.toLowerCase().includes(needle) ||
                (podcasts.get(episode.podcastId)?.title.toLowerCase().includes(needle) ?? false),
            );
      return hits.slice(0, 50).map((episode) => itemFor(episode));
    },
    subscribe: (listener) => changes.subscribe(listener),
    localPosition: (id) => positions[id],
    async offlineCandidates() {
      const [queueOutcome] = await Promise.all([rpc.call("queue.list", {}), refreshCatalog()]);
      const queue = readyValue("queue.list", queueOutcome, arrayOf(isQueueEntry));
      let remote: readonly OssiclePosition[] = [];
      try {
        remote = await serverPositions();
      } catch {
        remote = [];
      }
      const byId = new Map(remote.map((position) => [position.episodeId, position]));
      const offline = (episode: OssicleEpisode): OfflineEpisode => {
        const position = byId.get(episode.id) ?? episode.position;
        const local = positions[episode.id];
        const seconds = Math.max(position?.seconds ?? 0, local?.seconds ?? 0);
        return {
          id: episode.id,
          url: `${origin}${episode.audioPath}`,
          title: episode.title,
          played: position?.played ?? false,
          positionSec: seconds,
          ...(episode.durationSeconds === undefined ? {} : { durationSec: episode.durationSeconds }),
          ...(position?.updatedAt === undefined ? {} : { listenedAt: position.updatedAt }),
        };
      };
      for (const entry of queue) episodes.set(entry.episode.id, entry.episode);
      return {
        queue: queue.map((entry) => offline(entry.episode)),
        episodes: [...episodes.values()]
          .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
          .map(offline),
      };
    },
    dispose() {
      for (const [type, handler] of Object.entries(handlers)) {
        element.removeEventListener(type as keyof typeof handlers, handler);
      }
      element.pause();
      changes.clear();
    },
  };
}
