import { createAudioOutput } from "../audio/output";
import { createMemoryStorage, settle } from "../audio/testing/listening-fixture";
import { ScriptedMediaElement } from "../audio/testing/scripted-media-element";
import type { Item } from "../contract";
import { createOssiclePodcasts } from "./ossicle-podcasts";
import { createOssicleRpc } from "./ossicle-rpc";
import { resolvePositionConflict } from "./position-conflict";
import { createInMemoryOssicle } from "./testing/in-memory-ossicle";

const episode: Item = { source: "podcasts", id: "e-4", title: "Gears of Glass", by: "The Quiet Engine" };

function setup(storage = createMemoryStorage()) {
  const ossicle = createInMemoryOssicle();
  const element = new ScriptedMediaElement({ durationFor: () => 2400 });
  const adapter = createOssiclePodcasts({
    rpc: createOssicleRpc({ origin: ossicle.origin, fetch: ossicle.fetch }),
    origin: ossicle.origin,
    output: createAudioOutput(element),
    storage,
    deviceId: "vela-car",
  });
  return { ossicle, element, adapter, storage };
}

const writes = (ossicle: ReturnType<typeof createInMemoryOssicle>) =>
  ossicle.calls.filter((call) => call.tag === "position.write").map((call) => call.payload);

describe("conflict rule", () => {
  test("theirs wins unless the car is ahead", () => {
    expect(resolvePositionConflict(600, 900)).toEqual({ kind: "keepMine" });
    expect(resolvePositionConflict(900, 600)).toEqual({ kind: "takeTheirs" });
    expect(resolvePositionConflict(600, 600)).toEqual({ kind: "takeTheirs" });
  });
});

describe("Podcasts from Ossicle", () => {
  test("plays the audio path from /audio, never the video path", async () => {
    const { adapter, element, ossicle } = setup();
    await adapter.load({ ...episode, id: "e-3" });
    expect(element.src).toBe(`${ossicle.origin}/audio/e-3?v=a3`);
    expect(element.src).not.toContain("/video/");
  });

  test("resumes at Ossicle's position and writes with baseRevision and deviceId", async () => {
    const { adapter, element, ossicle } = setup();
    ossicle.writeFromOtherDevice("e-4", 300);
    await adapter.load(episode);
    await settle();
    expect(element.currentTime).toBe(300);
    await adapter.play();
    element.advance(60);
    await adapter.syncPosition();
    expect(writes(ossicle).at(-1)).toEqual({
      episodeId: "e-4",
      seconds: 360,
      baseRevision: 1,
      deviceId: "vela-car",
      force: false,
    });
    expect(ossicle.positions.get("e-4")).toMatchObject({ seconds: 360, revision: 2, deviceId: "vela-car" });
  });

  test("on a conflict where another device is ahead, the car takes theirs and moves there", async () => {
    const { adapter, element, ossicle } = setup();
    await adapter.load(episode);
    await adapter.play();
    await settle();
    element.advance(100);
    await adapter.syncPosition();
    expect(ossicle.positions.get("e-4")?.revision).toBe(1);

    // The kitchen tablet listened further while the car was parked.
    ossicle.writeFromOtherDevice("e-4", 1500);
    element.advance(20);
    await adapter.syncPosition();
    expect(element.currentTime).toBe(1500);
    expect(adapter.localPosition("e-4")).toMatchObject({ seconds: 1500, revision: 2, dirty: false });
    expect(ossicle.positions.get("e-4")?.seconds).toBe(1500);
  });

  test("on a conflict where the car is ahead, the car forces its position against their revision", async () => {
    const { adapter, element, ossicle } = setup();
    await adapter.load(episode);
    await adapter.play();
    await settle();
    element.advance(100);
    await adapter.syncPosition();
    ossicle.writeFromOtherDevice("e-4", 50);
    element.advance(500);
    await adapter.syncPosition();

    const [conflicting, forced] = writes(ossicle).slice(-2);
    expect(conflicting).toMatchObject({ seconds: 600, baseRevision: 1, force: false });
    expect(forced).toMatchObject({ seconds: 600, baseRevision: 2, force: true });
    expect(ossicle.positions.get("e-4")).toMatchObject({ seconds: 600, revision: 3 });
    expect(element.currentTime).toBe(600);
  });

  test("within Ossicle's 5 s agreement window a stale write is accepted without moving", async () => {
    const { adapter, element, ossicle } = setup();
    await adapter.load(episode);
    await adapter.play();
    await settle();
    element.advance(100);
    await adapter.syncPosition();
    ossicle.writeFromOtherDevice("e-4", 103);
    element.advance(1);
    await adapter.syncPosition();
    expect(element.currentTime).toBe(101);
    expect(adapter.localPosition("e-4")).toMatchObject({ revision: 2, dirty: false });
  });

  test("positions written offline stay on the device and are written later", async () => {
    const storage = createMemoryStorage();
    const { adapter, element, ossicle } = setup(storage);
    await adapter.load(episode);
    await adapter.play();
    await settle();
    ossicle.offline = true;
    element.advance(200);
    await expect(adapter.syncPosition()).rejects.toThrow(/unreachable/);
    expect(adapter.localPosition("e-4")).toMatchObject({ seconds: 200, dirty: true });

    ossicle.offline = false;
    await adapter.syncPosition();
    expect(ossicle.positions.get("e-4")?.seconds).toBe(200);
    expect(adapter.localPosition("e-4")?.dirty).toBe(false);
  });

  test("an unsynced car position survives a restart and is settled at load", async () => {
    const storage = createMemoryStorage();
    const first = setup(storage);
    await first.adapter.load(episode);
    await first.adapter.play();
    await settle();
    first.ossicle.offline = true;
    first.element.advance(900);
    first.element.pause();

    const second = setup(storage);
    second.ossicle.writeFromOtherDevice("e-4", 400);
    await second.adapter.load(episode);
    await settle();
    // The car is ahead of the tablet, so the car's 900 s wins.
    expect(second.element.currentTime).toBe(900);
    expect(second.ossicle.positions.get("e-4")?.seconds).toBe(900);
  });

  test("search covers episode and show titles; finishing marks the episode played", async () => {
    const { adapter, element, ossicle } = setup();
    expect((await adapter.search("tide")).map((item) => item.id)).toEqual(["e-5", "e-2"]);
    expect((await adapter.search("glass"))[0]).toMatchObject({
      id: "e-4",
      by: "The Quiet Engine",
      artUrl: `${ossicle.origin}/covers/p-engine?v=1`,
      durationSec: 2400,
    });
    await adapter.load(episode);
    await adapter.play();
    await settle();
    element.advance(5000);
    await settle();
    expect(ossicle.positions.get("e-4")?.played).toBe(true);
  });

  test("a cold start in a dead zone plays the same versioned audio URL the downloads stored", async () => {
    const storage = createMemoryStorage();
    const warm = setup(storage);
    const candidates = await warm.adapter.offlineCandidates();
    const stored = candidates.episodes.find((entry) => entry.id === "e-4")?.url;
    expect(stored).toBe(`${warm.ossicle.origin}/audio/e-4?v=a4`);

    const cold = setup(storage);
    cold.ossicle.offline = true;
    await cold.adapter.load(episode);
    expect(cold.element.src).toBe(stored);
    expect((await cold.adapter.search("glass"))[0]).toMatchObject({ id: "e-4", by: "The Quiet Engine" });
  });
});
