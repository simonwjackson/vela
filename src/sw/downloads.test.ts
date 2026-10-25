import { createMemoryStorage } from "../audio/testing/listening-fixture";
import type { Item } from "../contract";
import {
  type OfflineEpisode,
  diffDownloads,
  downloadNetwork,
  selectNarrationAhead,
  selectPodcastDownloads,
} from "./download-plan";
import { type DownloadSources, createDownloads } from "./downloads";
import { createMemoryOfflineAudio } from "./offline-cache";

const origins = { pyxis: "https://pyxis.test", ossicle: "https://ossicle.test" };
const episode = (id: string, extra: Partial<OfflineEpisode> = {}): OfflineEpisode => ({
  id,
  url: `https://ossicle.test/audio/${id}`,
  title: `Episode ${id}`,
  played: false,
  positionSec: 0,
  durationSec: 1000,
  ...extra,
});

describe("Wi-Fi only", () => {
  test("uses the connection type when the browser reports one", () => {
    expect(downloadNetwork({ type: "wifi" }, false)).toEqual({ kind: "allowed", reason: "wifi" });
    expect(downloadNetwork({ type: "ethernet" }, false).kind).toBe("allowed");
    expect(downloadNetwork({ type: "cellular" }, true)).toEqual({ kind: "blocked", reason: "metered" });
  });

  test("falls back to the manual flag without the Network Information API", () => {
    expect(downloadNetwork(undefined, false)).toEqual({ kind: "blocked", reason: "manual-off" });
    expect(downloadNetwork(undefined, true)).toEqual({ kind: "allowed", reason: "manual" });
    expect(downloadNetwork({ type: "unknown" }, true).kind).toBe("allowed");
    expect(downloadNetwork({}, false).kind).toBe("blocked");
  });
});

describe("selection rules", () => {
  test("the whole queue plus the next 3 unplayed, started ones first", () => {
    const chosen = selectPodcastDownloads({
      queue: [episode("q1"), episode("q2", { played: true })],
      episodes: [
        episode("new1"),
        episode("played", { played: true }),
        episode("finished", { positionSec: 990 }),
        episode("started-old", { positionSec: 100, listenedAt: "2026-10-01T00:00:00Z" }),
        episode("new2"),
        episode("started-new", { positionSec: 50, listenedAt: "2026-10-20T00:00:00Z" }),
        episode("q1"),
        episode("new3"),
      ],
    });
    expect(chosen.map((entry) => entry.id)).toEqual(["q1", "q2", "started-new", "started-old", "new1"]);
  });

  test("narration windows until three hours are covered", () => {
    const hour = 60 * 60 * 1000;
    const pieces = Array.from({ length: 10 }, (_, index) => ({ url: `w${index}`, durationMs: hour / 2 }));
    expect(selectNarrationAhead(pieces).map((piece) => piece.url)).toEqual(["w0", "w1", "w2", "w3", "w4", "w5"]);
  });

  test("diff fetches what is missing and evicts what is no longer wanted", () => {
    const target = (url: string) => ({ source: "music" as const, url, label: url, auth: "pyxis" as const });
    expect(diffDownloads([target("a"), target("b"), target("b")], ["b", "c"])).toEqual({
      fetch: [target("a")],
      evict: ["c"],
    });
  });
});

describe("the download runner", () => {
  const book: Item = { source: "books", id: "b-1", title: "An Invented Book", by: "Someone" };

  function setup(overrides: Partial<DownloadSources> = {}) {
    const offline = createMemoryOfflineAudio();
    const fetched: { url: string; authorization: string | null }[] = [];
    const sources: DownloadSources = {
      podcasts: async () => ({ queue: [episode("q1")], episodes: [episode("e1"), episode("e2")] }),
      currentBook: () => book,
      narrationAhead: async () => [{ url: "https://ossicle.test/comics/narration/b-1/0.ogg", durationMs: 80_000 }],
      pinnedTracks: async () => [{ url: "https://pyxis.test/stream/t-1", label: "Harbor Lights: Low Tide Overture" }],
      ...overrides,
    };
    let connection: { type?: string } | undefined = { type: "wifi" };
    const downloads = createDownloads({
      origins,
      offline,
      sources,
      fetch: async (input, init) => {
        fetched.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
        return new Response(new Uint8Array(8), { status: 200, headers: { "content-type": "audio/mpeg" } });
      },
      pyxisToken: async () => "device-token-test",
      connection: () => connection,
      storage: createMemoryStorage(),
    });
    return {
      downloads,
      offline,
      fetched,
      setConnection: (next: { type?: string } | undefined) => {
        connection = next;
      },
    };
  }

  test("on Wi-Fi it saves podcasts, narration and pinned music, with the token only for Pyxis", async () => {
    const { downloads, offline, fetched } = setup();
    await downloads.run();
    expect([...(await offline.keys())].sort()).toEqual([
      "https://ossicle.test/audio/e1",
      "https://ossicle.test/audio/e2",
      "https://ossicle.test/audio/q1",
      "https://ossicle.test/comics/narration/b-1/0.ogg",
      "https://pyxis.test/stream/t-1",
    ]);
    expect(fetched.find((entry) => entry.url.includes("/stream/"))?.authorization).toBe("Bearer device-token-test");
    expect(fetched.find((entry) => entry.url.includes("/audio/"))?.authorization).toBeNull();
    expect(downloads.status.phase).toMatchObject({ kind: "done", saved: 5, failed: 0 });
  });

  test("on mobile data nothing downloads", async () => {
    const { downloads, offline, setConnection } = setup();
    setConnection({ type: "cellular" });
    await downloads.run();
    expect(await offline.keys()).toEqual([]);
    expect(downloads.status.phase).toEqual({ kind: "blocked", network: { kind: "blocked", reason: "metered" } });
  });

  test("the manual flag allows downloads when the browser cannot tell", async () => {
    const { downloads, offline, setConnection } = setup();
    setConnection(undefined);
    await downloads.run();
    expect(await offline.keys()).toEqual([]);
    downloads.setManualWifi(true);
    await downloads.run();
    expect((await offline.keys()).length).toBe(5);
  });

  test("unwanted copies are evicted, but a Source that cannot answer keeps its copies", async () => {
    const { downloads, offline } = setup({
      podcasts: async () => {
        throw new Error("Ossicle is unreachable");
      },
      pinnedTracks: async () => [],
    });
    await offline.put("https://ossicle.test/audio/old", new Response("x"));
    await offline.put("https://pyxis.test/stream/unpinned", new Response("x"));
    await downloads.run();
    const keys = await offline.keys();
    expect(keys).toContain("https://ossicle.test/audio/old");
    expect(keys).not.toContain("https://pyxis.test/stream/unpinned");
    expect(downloads.status.problems.podcasts).toBe("Ossicle is unreachable");
  });

  test("losing Wi-Fi stops the file in flight and stores nothing partial", async () => {
    const offline = createMemoryOfflineAudio();
    let connection: { type?: string } = { type: "wifi" };
    const downloads = createDownloads({
      origins,
      offline,
      sources: {
        podcasts: async () => ({ queue: [episode("q1")], episodes: [] }),
        currentBook: () => undefined,
        narrationAhead: async () => [],
        pinnedTracks: async () => [],
      },
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          connection = { type: "cellular" };
        }),
      pyxisToken: async () => undefined,
      connection: () => connection,
      storage: createMemoryStorage(),
      networkCheckMs: 5,
    });
    await downloads.run();
    expect(await offline.keys()).toEqual([]);
    expect(downloads.status.items[0]).toMatchObject({ state: "failed", error: "Wi-Fi was lost" });
  });
});
