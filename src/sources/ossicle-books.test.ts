import { createAudioOutput } from "../audio/output";
import { createMemoryStorage, settle } from "../audio/testing/listening-fixture";
import { ScriptedMediaElement } from "../audio/testing/scripted-media-element";
import type { Item } from "../contract";
import { createMemoryNarrationStore } from "./narration-store";
import { createOssicleBooks } from "./ossicle-books";
import { createComicsClient } from "./ossicle-comics";
import { createInMemoryOssicle } from "./testing/in-memory-ossicle";

const book: Item = { source: "books", id: "b-lantern", title: "The Lantern Keeper", by: "A. Invented" };

function setup() {
  const ossicle = createInMemoryOssicle();
  const element = new ScriptedMediaElement({ durationFor: () => 80 });
  const narration = createMemoryNarrationStore();
  const sleeps: number[] = [];
  const books = createOssicleBooks({
    comics: createComicsClient({ origin: ossicle.origin, fetch: ossicle.fetch }),
    output: createAudioOutput(element),
    storage: createMemoryStorage(),
    deviceId: "vela-car",
    narration,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { ossicle, element, narration, books, sleeps };
}

const locatorAt = (ordinal: number, sentences = 40) => ({
  generation: "g1",
  resource: `chapter-${Math.floor(ordinal / 20)}.xhtml`,
  selector: `p:nth-of-type(${ordinal + 1})`,
  characterOffset: (ordinal % 20) * 100,
  textContext: "",
  resourceProgression: (ordinal % 20) / 20,
  wholeBookProgression: ordinal / sentences,
});

test("starts at the stored reading position and plays the prepared window", async () => {
  const { ossicle, element, books } = setup();
  ossicle.bookPositions.set("b-lantern", { locator: locatorAt(12), revision: 4, deviceId: "e-reader", updatedAt: "2026-10-01T00:00:00Z" });
  await books.load(book);
  expect(element.src).toBe(`${ossicle.origin}/comics/narration/b-lantern/12.ogg`);
  await books.play();
  await settle();
  element.advance(5);
  let state: number | undefined;
  books.subscribe((now) => {
    state = now?.positionSec;
  });
  element.advance(1);
  // Sentence 12 starts at 120 s in the timeline estimate.
  expect(state).toBe(126);
});

test("waits for synthesis by polling prepare until a window exists", async () => {
  const { ossicle, books, sleeps, element } = setup();
  ossicle.windowAfterPolls = 2;
  await books.load(book);
  expect(sleeps).toEqual([1500, 1500]);
  expect(element.src).toContain("/comics/narration/b-lantern/0.ogg");
});

test("moves on to the next window at the end of one", async () => {
  const { books, element } = setup();
  await books.load(book);
  await books.play();
  await settle();
  element.advance(100);
  await settle();
  expect(element.src).toContain("/narration/b-lantern/8.ogg");
  expect(element.paused).toBe(false);
});

test("a seek outside the window re-anchors at the sentence there", async () => {
  const { books, element } = setup();
  await books.load(book);
  await books.play();
  await settle();
  books.seek(250);
  await settle();
  expect(element.src).toContain("/narration/b-lantern/25.ogg");
  expect(element.paused).toBe(false);
});

test("position conflict: the reader's newer position wins unless the car is ahead", async () => {
  const { ossicle, books, element } = setup();
  await books.load(book);
  await books.play();
  await settle();
  element.advance(35);
  await books.syncPosition();
  expect(ossicle.bookPositions.get("b-lantern")).toMatchObject({ revision: 1, locator: { characterOffset: 300 } });

  // An e-reader moved further ahead.
  ossicle.bookPositions.set("b-lantern", { locator: locatorAt(30), revision: 2, deviceId: "e-reader", updatedAt: "x" });
  element.advance(10);
  await books.syncPosition();
  await settle();
  expect(element.src).toContain("/narration/b-lantern/30.ogg");

  // Now the car is ahead of a stale write from the e-reader.
  element.advance(15);
  await books.syncPosition();
  ossicle.bookPositions.set("b-lantern", { locator: locatorAt(2), revision: 9, deviceId: "e-reader", updatedAt: "y" });
  element.advance(10);
  await books.syncPosition();
  const forced = ossicle.calls.filter((call) => call.tag === "book.position.write").at(-1)?.payload;
  expect(forced).toMatchObject({ force: true, baseRevision: 9, characterOffset: 1200 });
  expect(ossicle.bookPositions.get("b-lantern")).toMatchObject({ revision: 10, locator: { characterOffset: 1200 } });
});

test("prepares the next hours ahead into the narration store, and plays them offline", async () => {
  const { ossicle, books, narration, element } = setup();
  const pieces = await books.narrationAhead(book, 200_000);
  // Windows of 80 s: three cover 200 s.
  expect(pieces.map((piece) => piece.url)).toEqual([
    `${ossicle.origin}/comics/narration/b-lantern/0.ogg`,
    `${ossicle.origin}/comics/narration/b-lantern/8.ogg`,
    `${ossicle.origin}/comics/narration/b-lantern/16.ogg`,
  ]);
  expect(narration.batches.size).toBe(3);

  ossicle.offline = true;
  await books.load(book);
  expect(element.src).toContain("/narration/b-lantern/0.ogg");
});

test("a cold start in a dead zone plays the narration prepared ahead", async () => {
  const storage = createMemoryStorage();
  const ossicle = createInMemoryOssicle();
  const narration = createMemoryNarrationStore();
  const make = () => {
    const element = new ScriptedMediaElement({ durationFor: () => 80 });
    const adapter = createOssicleBooks({
      comics: createComicsClient({ origin: ossicle.origin, fetch: ossicle.fetch }),
      output: createAudioOutput(element),
      storage,
      deviceId: "vela-car",
      narration,
      sleep: async () => undefined,
    });
    return { element, adapter };
  };
  await make().adapter.narrationAhead(book, 200_000);

  ossicle.offline = true;
  const cold = make();
  await cold.adapter.load(book);
  expect(cold.element.src).toBe(`${ossicle.origin}/comics/narration/b-lantern/0.ogg`);
  await cold.adapter.play();
  expect(cold.element.paused).toBe(false);
});

test("play() during a jump to another window starts the new window", async () => {
  const { books, element } = setup();
  await books.load(book);
  await books.play();
  await settle();
  element.pause();
  books.seek(250);
  await books.play();
  await settle();
  expect(element.src).toContain("/narration/b-lantern/25.ogg");
  expect(element.paused).toBe(false);
});

test("a seek into another window lands on the exact time, not the sentence start", async () => {
  const { books, element } = setup();
  await books.load(book);
  books.seek(253);
  await settle();
  expect(element.src).toContain("/narration/b-lantern/25.ogg");
  expect(element.currentTime).toBe(3);
});
