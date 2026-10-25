import { createAudioOutput } from "../audio/output";
import { createMemoryStorage, sequentialIds, settle } from "../audio/testing/listening-fixture";
import { ScriptedMediaElement } from "../audio/testing/scripted-media-element";
import { createMemoryCredentialStore } from "./pyxis-credentials";
import { createPyxisMusic } from "./pyxis-music";
import { PYXIS_CONTRACT_ID, createPyxisRpc } from "./pyxis-rpc";
import { PYXIS_DEVICE_TOKEN, createInMemoryPyxis } from "./testing/in-memory-pyxis";

function setup(storage = createMemoryStorage()) {
  const pyxis = createInMemoryPyxis();
  const element = new ScriptedMediaElement({ durationFor: () => 200 });
  const credentials = createMemoryCredentialStore();
  const music = createPyxisMusic({
    rpc: createPyxisRpc({ origin: pyxis.origin, fetch: pyxis.fetch }),
    origin: pyxis.origin,
    output: createAudioOutput(element),
    credentials,
    connect: pyxis.connect,
    storage,
    newId: sequentialIds,
  });
  return { pyxis, element, credentials, music, storage };
}

async function playFirstTrack(context: ReturnType<typeof setup>) {
  const [track] = await context.music.search("Low Tide");
  if (track === undefined) throw new Error("fixture track missing");
  await context.music.load(track);
  await context.music.play();
  await settle();
  return track;
}

const sessionOf = (pyxis: ReturnType<typeof createInMemoryPyxis>) => {
  const session = [...pyxis.sessions.values()][0];
  if (session === undefined) throw new Error("no session");
  return session;
};

describe("hosting a Pyxis session", () => {
  test("claims a device, stores its token, says hello, then creates the session after welcome", async () => {
    const context = setup();
    await context.music.start();
    expect(await context.credentials.read()).toMatchObject({ token: PYXIS_DEVICE_TOKEN, deviceId: "dev-car", sessionId: "sess-1" });
    const socket = context.pyxis.sockets[0];
    expect(socket?.url).toBe("wss://pyxis.test/realtime");
    expect(socket?.sent[0]).toEqual({
      _tag: "realtime.hello",
      payload: { contractId: PYXIS_CONTRACT_ID, bearerToken: PYXIS_DEVICE_TOKEN, topics: [] },
    });
    expect(sessionOf(context.pyxis).hostDeviceId).toBe("dev-car");
    expect(context.pyxis.missingContract).toEqual([]);
    context.music.dispose();
  });

  test("a second start re-adopts the stored session instead of creating another", async () => {
    const context = setup();
    await context.music.start();
    const credentials = await context.credentials.read();
    const again = createPyxisMusic({
      rpc: createPyxisRpc({ origin: context.pyxis.origin, fetch: context.pyxis.fetch }),
      origin: context.pyxis.origin,
      output: createAudioOutput(new ScriptedMediaElement()),
      credentials: createMemoryCredentialStore(credentials),
      connect: context.pyxis.connect,
      storage: createMemoryStorage(),
    });
    await again.start();
    expect(context.pyxis.sessions.size).toBe(1);
    expect(again.session?.id).toBe("sess-1");
    again.dispose();
    context.music.dispose();
  });

  test("pairing-required servers give a plain reason", async () => {
    const context = setup();
    context.pyxis.claimStatus = "pairingRequired";
    await expect(context.music.start()).rejects.toThrow(/paired/);
  });

  test("the driver's Play reaches audio first, then is reported as a host command", async () => {
    const context = setup();
    const track = await playFirstTrack(context);
    expect(context.element.src).toBe(`${context.pyxis.origin}/stream/${track.id}`);
    expect(context.element.paused).toBe(false);
    expect(context.pyxis.runs.map((run) => run.tag)).toEqual([
      "queue.clear",
      "queue.add",
      "cursor.jump",
      // Loading the track tells the core its duration, so seeks are allowed.
      "position.report",
      "transport.play",
    ]);
    const session = sessionOf(context.pyxis);
    expect(session.transport).toBe("playing");
    expect(session.queue).toEqual(["t-1", "t-2", "t-3"]);
    expect(session.durationMs).toBe(200_000);
    context.music.dispose();
  });

  test("a console directive is applied to audio and reported with its directiveId", async () => {
    const context = setup();
    await playFirstTrack(context);
    context.pyxis.direct({ _tag: "transport.pause", payload: {} }, "dir-1");
    await settle();
    expect(context.element.paused).toBe(true);
    expect(context.pyxis.runs.at(-1)).toEqual({ commandId: "dir-1", tag: "transport.pause" });
    expect(sessionOf(context.pyxis).transport).toBe("paused");

    context.pyxis.direct({ _tag: "cursor.jump", payload: { index: 2 } }, "dir-2");
    context.pyxis.direct({ _tag: "transport.play", payload: {} }, "dir-3");
    await settle();
    expect(context.element.src).toBe(`${context.pyxis.origin}/stream/t-3`);
    expect(context.element.paused).toBe(false);
    context.music.dispose();
  });

  test("a redelivered directive does not touch audio twice", async () => {
    const context = setup();
    await playFirstTrack(context);
    context.pyxis.direct({ _tag: "queue.add", payload: { trackIds: ["t-1"] } }, "dir-add");
    context.pyxis.direct({ _tag: "queue.add", payload: { trackIds: ["t-1"] } }, "dir-add");
    await settle();
    expect(context.music.session?.queue).toEqual(["t-1", "t-2", "t-3", "t-1"]);
    expect(context.pyxis.runs.filter((run) => run.commandId === "dir-add")).toHaveLength(1);
    context.music.dispose();
  });

  test("a delayed seek fenced to an older revision is dropped", async () => {
    const context = setup();
    await playFirstTrack(context);
    context.element.advance(30);
    const stale = (context.music.session?.revision ?? 0) - 1;
    context.pyxis.direct({ _tag: "transport.seek", payload: { positionMs: 150_000 } }, "dir-seek", stale);
    await settle();
    expect(context.element.currentTime).toBe(30);
    expect(context.pyxis.runs.some((run) => run.commandId === "dir-seek")).toBe(false);
    context.music.dispose();
  });

  test("when the renderer refuses Play, nothing is reported", async () => {
    const context = setup();
    const [track] = await context.music.search("Fog");
    if (track === undefined) throw new Error("fixture track missing");
    await context.music.load(track);
    context.element.playFails = true;
    await expect(context.music.play()).rejects.toThrow(/blocked/);
    expect(context.pyxis.runs.some((run) => run.tag === "transport.play")).toBe(false);
    expect(sessionOf(context.pyxis).transport).toBe("stopped");
    context.music.dispose();
  });

  test("a finished track is logged as a listen and the queue moves on", async () => {
    const context = setup();
    await playFirstTrack(context);
    context.element.advance(500);
    await settle();
    expect(context.pyxis.listens).toEqual([
      expect.objectContaining({
        trackId: "t-1",
        deviceId: "dev-car",
        completed: true,
        context: "queue",
        contextId: "sess-1",
        albumId: "alb-harbor",
        playedMs: 200_000,
      }),
    ]);
    expect(context.element.src).toBe(`${context.pyxis.origin}/stream/t-2`);
    expect(sessionOf(context.pyxis)).toMatchObject({ currentTrackId: "t-2", transport: "playing" });
    context.music.dispose();
  });

  test("in a dead zone, commands and listens wait on the device and replay in order", async () => {
    const context = setup();
    await playFirstTrack(context);
    context.pyxis.offline = true;
    context.music.forward();
    await settle();
    context.element.advance(500);
    await settle();
    // Audio kept going from the local projection.
    expect(context.element.src).toBe(`${context.pyxis.origin}/stream/t-3`);
    expect(context.music.pending).toEqual({ commands: 3, listens: 1 });

    context.pyxis.offline = false;
    await context.music.flush();
    expect(context.music.pending).toEqual({ commands: 0, listens: 0 });
    expect(sessionOf(context.pyxis)).toMatchObject({ currentTrackId: "t-3", transport: "playing" });
    expect(context.pyxis.listens.map((listen) => listen.trackId)).toEqual(["t-2"]);
    context.music.dispose();
  });

  test("the socket reconnects with backoff after a drop", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const context = setup();
      const starting = context.music.start();
      await settle();
      await starting;
      expect(context.music.realtime.kind).toBe("connected");
      context.pyxis.sockets[0]?.close();
      expect(context.music.realtime).toEqual({ kind: "retrying", inMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      await settle();
      expect(context.pyxis.sockets).toHaveLength(2);
      expect(context.music.realtime.kind).toBe("connected");
      expect(context.pyxis.sockets[1]?.sent[0]).toMatchObject({ payload: { resumeToken: "epoch:1" } });
      context.music.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
