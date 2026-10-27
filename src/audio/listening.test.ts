import type { Item } from "../contract";
import { TALK_RESUME_BACK_SEC } from "../contract";
import { turnSoundYield } from "./listening";
import { createListeningFixture, settle } from "./testing/listening-fixture";

const episode: Item = { source: "podcasts", id: "e-4", title: "Gears of Glass", by: "The Quiet Engine" };
const book: Item = { source: "books", id: "b-lantern", title: "The Lantern Keeper", by: "A. Invented" };

async function musicItem(fixture: ReturnType<typeof createListeningFixture>, title = "Gull"): Promise<Item> {
  const [item] = await fixture.listening.search("music", title);
  if (item === undefined) throw new Error("no music fixture");
  return item;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("one Now playing at a time", () => {
  test("starting a Podcast pauses Music, and starting Music pauses the Podcast", async () => {
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: await musicItem(fixture) });
    await settle();
    expect(listening.nowPlaying?.item.source).toBe("music");
    expect(listening.nowPlaying?.transport).toBe("playing");
    expect(elements.music.paused).toBe(false);

    await listening.send({ type: "playItem", item: episode });
    await settle();
    expect(elements.music.paused).toBe(true);
    expect(elements.podcasts.paused).toBe(false);
    expect(listening.nowPlaying?.item).toMatchObject({ source: "podcasts", id: "e-4" });

    await listening.send({ type: "playItem", item: book });
    await settle();
    expect(elements.podcasts.paused).toBe(true);
    expect(elements.books.paused).toBe(false);
    expect(listening.nowPlaying?.item.source).toBe("books");
    listening.dispose();
  });

  test("a Source that starts by itself takes Now playing and pauses the other", async () => {
    const fixture = createListeningFixture();
    const { listening, elements, pyxis } = fixture;
    await listening.send({ type: "playItem", item: await musicItem(fixture) });
    await settle();
    await listening.send({ type: "playItem", item: episode });
    await settle();
    expect(listening.nowPlaying?.item.source).toBe("podcasts");

    // A console in the house presses Play on the car's Pyxis session.
    pyxis.direct({ _tag: "transport.play", payload: {} }, "dir-takeover");
    await settle();
    expect(listening.nowPlaying?.item.source).toBe("music");
    expect(elements.podcasts.paused).toBe(true);
    expect(elements.music.paused).toBe(false);
    listening.dispose();
  });

  test("a failed load shows an error on Now playing", async () => {
    const fixture = createListeningFixture();
    await fixture.listening.send({ type: "playItem", item: { ...book, id: "b-missing" } });
    await settle();
    expect(fixture.listening.nowPlaying?.transport).toBe("error");
    expect(fixture.listening.nowPlaying?.error).toMatch(/not in the library/);
    fixture.listening.dispose();
  });
});

describe("the Shelf", () => {
  test("keeps the last Item of each Source and resumes it with one tap", async () => {
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    const track = await musicItem(fixture);
    await listening.send({ type: "playItem", item: episode });
    await settle();
    elements.podcasts.advance(120);
    await listening.send({ type: "playItem", item: track });
    await settle();

    expect(listening.shelf.podcasts?.id).toBe("e-4");
    expect(listening.shelf.music?.id).toBe(track.id);
    expect(fixture.shelfStore.saved.podcasts?.id).toBe("e-4");

    await listening.send({ type: "resume", source: "podcasts" });
    await settle();
    expect(listening.nowPlaying?.item.id).toBe("e-4");
    expect(listening.nowPlaying?.transport).toBe("playing");
    // Resumed where the car left off, not from the top.
    expect(elements.podcasts.currentTime).toBe(120);
    expect(elements.music.paused).toBe(true);
    listening.dispose();
  });

  test("a Service's newer last Item replaces the stored entry at start", async () => {
    const fixture = createListeningFixture({ seed: ({ ossicle }) => ossicle.writeFromOtherDevice("e-2", 300) });
    await fixture.listening.ready;
    expect(fixture.listening.shelf.podcasts).toMatchObject({ id: "e-2", title: "Low Water", by: "Tide Tables" });
    fixture.listening.dispose();
  });

  test("the stored Shelf stays when the Services cannot answer", async () => {
    const fixture = createListeningFixture({ shelf: { music: undefined, podcasts: episode, books: book } });
    fixture.ossicle.offline = true;
    fixture.pyxis.offline = true;
    await fixture.listening.ready;
    expect(fixture.listening.shelf.podcasts?.id).toBe("e-4");
    expect(fixture.listening.shelf.books?.id).toBe("b-lantern");
    fixture.listening.dispose();
  });
});

describe("Turn sounds", () => {
  test("policy: Music ducks, Podcasts and Books pause and rewind", () => {
    expect(turnSoundYield("music")).toBe("duck");
    expect(turnSoundYield("podcasts")).toBe("pause-and-rewind");
    expect(turnSoundYield("books")).toBe("pause-and-rewind");
  });

  test("Music gets quieter under the sound and comes back after it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: await musicItem(fixture) });
    await settle();
    const before = elements.music.volume;

    await listening.yieldForTurnSound(1200);
    expect(elements.music.volume).toBeCloseTo(before * 0.25);
    expect(elements.music.paused).toBe(false);

    await vi.advanceTimersByTimeAsync(1199);
    expect(elements.music.volume).toBeCloseTo(before * 0.25);
    await vi.advanceTimersByTimeAsync(1);
    expect(elements.music.volume).toBeCloseTo(before);
    listening.dispose();
  });

  test("a Podcast pauses under the sound and resumes two seconds back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: episode });
    await settle();
    elements.podcasts.advance(300);

    await listening.yieldForTurnSound(1500);
    expect(elements.podcasts.paused).toBe(true);
    expect(elements.podcasts.volume).toBe(1);

    await vi.advanceTimersByTimeAsync(1500);
    await settle();
    expect(elements.podcasts.paused).toBe(false);
    expect(elements.podcasts.currentTime).toBe(300 - TALK_RESUME_BACK_SEC);
    listening.dispose();
  });

  test("a Book pauses and resumes two seconds back too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: book });
    await settle();
    elements.books.advance(25);
    await listening.yieldForTurnSound(800);
    expect(elements.books.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    expect(elements.books.paused).toBe(false);
    expect(elements.books.currentTime).toBe(25 - TALK_RESUME_BACK_SEC);
    listening.dispose();
  });

  test("a driver pause during the sound cancels the automatic resume", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: episode });
    await settle();
    elements.podcasts.advance(60);
    await listening.yieldForTurnSound(1000);
    await listening.send({ type: "pause" });
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(elements.podcasts.paused).toBe(true);
    expect(elements.podcasts.currentTime).toBe(60);
    listening.dispose();
  });

  test("overlapping sounds hold until the last one ends, and rewind only once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: episode });
    await settle();
    elements.podcasts.advance(100);
    await listening.yieldForTurnSound(1000);
    await vi.advanceTimersByTimeAsync(500);
    await listening.yieldForTurnSound(1000);
    await vi.advanceTimersByTimeAsync(600);
    expect(elements.podcasts.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(elements.podcasts.paused).toBe(false);
    expect(elements.podcasts.currentTime).toBe(98);
    listening.dispose();
  });

  test("nothing happens when nothing plays", async () => {
    const fixture = createListeningFixture();
    await expect(fixture.listening.yieldForTurnSound(1000)).resolves.toBeUndefined();
    expect(fixture.elements.music.volume).toBe(1);
    fixture.listening.dispose();
  });
});

describe("Turn sounds near a narration window start", () => {
  test("a Book 1 s into its second window resumes playing 2 s back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: book });
    await settle();
    elements.books.advance(81); // ends window 1 (80 s) and moves into window 2
    await settle();
    expect(elements.books.src).toContain("/narration/b-lantern/8.ogg");
    elements.books.advance(1);
    expect(listening.nowPlaying?.positionSec).toBe(81);

    await listening.yieldForTurnSound(800);
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    expect(listening.nowPlaying?.transport).toBe("playing");
    expect(elements.books.paused).toBe(false);
    expect(listening.nowPlaying?.positionSec).toBe(79);
    listening.dispose();
  });
});

describe("Turn sounds near a narration window start, without signal", () => {
  async function bookAt81sOffline(keep?: ReadonlySet<number>) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const fixture = createListeningFixture();
    const { listening, elements, books, narration, ossicle } = fixture;
    await books.narrationAhead(book, 3 * 60 * 60 * 1000);
    if (keep !== undefined) await narration.retainOnly("b-lantern", "g1", keep);
    await listening.send({ type: "playItem", item: book });
    await settle();
    ossicle.offline = true;
    elements.books.advance(80); // window 0 ends; window 8 starts from the store
    await settle();
    elements.books.advance(1);
    expect(elements.books.src).toContain("/narration/b-lantern/8.ogg");
    expect(listening.nowPlaying?.positionSec).toBe(81);
    await listening.yieldForTurnSound(800);
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    return fixture;
  }

  test("rewinds into the previous stored window at the exact time and keeps playing", async () => {
    const { listening, elements } = await bookAt81sOffline();
    expect(listening.nowPlaying?.transport).toBe("playing");
    expect(elements.books.src).toContain("/narration/b-lantern/0.ogg");
    expect(elements.books.currentTime).toBe(79);
    expect(listening.nowPlaying?.positionSec).toBe(79);
    listening.dispose();
  });

  test("with the previous window not stored, clamps to the current window start and keeps playing", async () => {
    const { listening, elements } = await bookAt81sOffline(new Set([8, 16]));
    expect(listening.nowPlaying?.transport).toBe("playing");
    expect(listening.nowPlaying?.error).toBeUndefined();
    expect(elements.books.src).toContain("/narration/b-lantern/8.ogg");
    expect(listening.nowPlaying?.positionSec).toBe(80);
    listening.dispose();
  });
});

describe("holding for the Co-driver's speech", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });

  test("Music ducks for the whole answer, through a Turn sound, and restores on release", async () => {
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: await musicItem(fixture) });
    await settle();
    const before = elements.music.volume;

    const release = listening.holdForTalk();
    expect(elements.music.volume).toBeCloseTo(before * 0.25);
    expect(elements.music.paused).toBe(false);
    // A Turn sound ends mid-answer: Music stays ducked.
    await listening.yieldForTurnSound(500);
    await vi.advanceTimersByTimeAsync(600);
    expect(elements.music.volume).toBeCloseTo(before * 0.25);

    release();
    expect(elements.music.volume).toBeCloseTo(before);
    release(); // a second call does nothing
    expect(elements.music.volume).toBeCloseTo(before);
    listening.dispose();
  });

  test("a Podcast pauses while the Co-driver speaks and resumes two seconds back", async () => {
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: episode });
    await settle();
    elements.podcasts.advance(300);

    const first = listening.holdForTalk();
    const second = listening.holdForTalk();
    expect(elements.podcasts.paused).toBe(true);
    first();
    await settle();
    expect(elements.podcasts.paused).toBe(true);
    second();
    await settle();
    expect(elements.podcasts.paused).toBe(false);
    expect(elements.podcasts.currentTime).toBe(300 - TALK_RESUME_BACK_SEC);
    listening.dispose();
  });

  test("a Book paused by a Turn sound waits for the answer to end", async () => {
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: book });
    await settle();
    elements.books.advance(25);
    await listening.yieldForTurnSound(800);
    const release = listening.holdForTalk();
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(elements.books.paused).toBe(true);
    release();
    await settle();
    expect(elements.books.paused).toBe(false);
    expect(elements.books.currentTime).toBe(25 - TALK_RESUME_BACK_SEC);
    listening.dispose();
  });

  test("a driver pause during the answer cancels the resume", async () => {
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: episode });
    await settle();
    elements.podcasts.advance(60);
    const release = listening.holdForTalk();
    await listening.send({ type: "pause" });
    release();
    await settle();
    expect(elements.podcasts.paused).toBe(true);
    expect(elements.podcasts.currentTime).toBe(60);
    listening.dispose();
  });
});


describe("holding while the driver talks", () => {
  test.each(["music", "podcasts", "books"] as const)("pauses %s immediately, nests with speech, and resumes only once", async (source) => {
    const fixture = createListeningFixture();
    const { listening, elements } = fixture;
    const item = source === "music" ? await musicItem(fixture) : source === "podcasts" ? episode : book;
    await listening.send({ type: "playItem", item }); await settle();
    elements[source].advance(20);
    const release = listening.holdForTalk("listening");
    expect(elements[source].paused).toBe(true);
    const answer = listening.holdForTalk();
    release(); await settle(); expect(elements[source].paused).toBe(true);
    answer(); await settle(); expect(elements[source].paused).toBe(false);
    expect(listening.nowPlaying?.positionSec).toBe(source === "music" ? 20 : 18);
    answer(); await settle(); expect(listening.nowPlaying?.positionSec).toBe(source === "music" ? 20 : 18);
    listening.dispose();
  });

  test.each(["music", "podcasts", "books"] as const)("never resumes %s paused by the driver before or during Talk", async (source) => {
    const fixture = createListeningFixture(); const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: source === "music" ? await musicItem(fixture) : source === "podcasts" ? episode : book }); await settle();
    await listening.send({ type: "pause" });
    listening.holdForTalk("listening")(); await settle(); expect(elements[source].paused).toBe(true);
    await listening.send({ type: "play" }); await settle();
    const release = listening.holdForTalk("listening");
    await listening.send({ type: "pause" }); release(); await settle(); expect(elements[source].paused).toBe(true);
    listening.dispose();
  });

  test("a listening hold takes over Music already ducked for speech", async () => {
    const fixture = createListeningFixture(); const { listening, elements } = fixture;
    await listening.send({ type: "playItem", item: await musicItem(fixture) }); await settle();
    const volume = elements.music.volume;
    const speech = listening.holdForTalk();
    const driver = listening.holdForTalk("listening");
    speech(); await settle(); expect(elements.music.paused).toBe(true);
    driver(); await settle(); expect(elements.music.paused).toBe(false); expect(elements.music.volume).toBe(volume);
    listening.dispose();
  });
});


test.each(["music", "podcasts", "books"] as const)("absolute device volume on %s survives pause/resume and restores after ducking", async (source) => {
  const fixture = createListeningFixture(); const { listening, elements } = fixture;
  await listening.send({ type: "playItem", item: source === "music" ? await musicItem(fixture) : source === "podcasts" ? episode : book }); await settle();
  await listening.send({ type: "volume", volume: 42 }); expect(elements[source].volume).toBeCloseTo(0.42);
  const release = listening.holdForTalk();
  await listening.send({ type: "volume", volume: 60 }); release(); await settle();
  expect(elements[source].volume).toBeCloseTo(0.6); expect(elements[source].paused).toBe(false);
  await listening.send({ type: "volume", volume: 0 }); expect(elements[source].volume).toBe(0);
  await listening.send({ type: "volume", volume: 100 }); expect(elements[source].volume).toBe(1);
  await expect(listening.send({ type: "volume", volume: Number.NaN })).rejects.toThrow("volume");
  listening.dispose();
});
