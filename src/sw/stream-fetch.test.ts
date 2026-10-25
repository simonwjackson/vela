import { createMemoryCredentialStore } from "../sources/pyxis-credentials";
import { createMemoryOfflineAudio } from "./offline-cache";
import { parseRange } from "./range";
import { handleListeningFetch, listeningRequestKind } from "./stream-fetch";

const origins = { pyxis: "https://pyxis.test", ossicle: "https://ossicle.test" };
const credentials = createMemoryCredentialStore({ token: "device-token-test", deviceId: "dev-car", accountId: "default" });

/** A network that records what the worker sent and answers like Pyxis /stream. */
function recordingNetwork() {
  const sent: Request[] = [];
  const network: typeof fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(String(input));
    sent.push(request);
    const range = request.headers.get("range");
    return new Response("partial", {
      status: range === null ? 200 : 206,
      headers: range === null ? {} : { "content-range": "bytes 0-6/1000" },
    });
  };
  return { sent, network };
}

describe("which requests the worker handles", () => {
  test("Pyxis stream, Ossicle audio and narration; nothing else", () => {
    const kind = (url: string, method = "GET") => listeningRequestKind(new Request(url, { method }), origins);
    expect(kind("https://pyxis.test/stream/t-1")).toBe("pyxis-stream");
    expect(kind("https://pyxis.test/rpc", "POST")).toBeUndefined();
    expect(kind("https://pyxis.test/stream/t-1", "HEAD")).toBeUndefined();
    expect(kind("https://ossicle.test/audio/e-1?v=a1")).toBe("ossicle-audio");
    expect(kind("https://ossicle.test/comics/narration/b/0.ogg")).toBe("ossicle-audio");
    expect(kind("https://ossicle.test/covers/p-1")).toBeUndefined();
    expect(kind("https://elsewhere.test/stream/t-1")).toBeUndefined();
  });
});

describe("Bearer header injection", () => {
  test("adds the device token and passes Range through unchanged", async () => {
    const { sent, network } = recordingNetwork();
    const request = new Request("https://pyxis.test/stream/t-1", { headers: { range: "bytes=500-" } });
    const response = await handleListeningFetch(request, "pyxis-stream", {
      origins,
      offline: createMemoryOfflineAudio(),
      credentials,
      fetch: network,
    });
    expect(response.status).toBe(206);
    const forwarded = sent[0];
    expect(forwarded?.url).toBe("https://pyxis.test/stream/t-1");
    expect(forwarded?.headers.get("authorization")).toBe("Bearer device-token-test");
    expect(forwarded?.headers.get("range")).toBe("bytes=500-");
  });

  test("does not add the token to Ossicle audio", async () => {
    const { sent, network } = recordingNetwork();
    await handleListeningFetch(new Request("https://ossicle.test/audio/e-1?v=a1"), "ossicle-audio", {
      origins,
      offline: createMemoryOfflineAudio(),
      credentials,
      fetch: network,
    });
    expect(sent[0]?.headers.get("authorization")).toBeNull();
  });

  test("without signal or copy the answer is 503", async () => {
    const response = await handleListeningFetch(new Request("https://pyxis.test/stream/t-9"), "pyxis-stream", {
      origins,
      offline: createMemoryOfflineAudio(),
      credentials,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(response.status).toBe(503);
  });
});

describe("offline copies", () => {
  const bytes = Uint8Array.from({ length: 100 }, (_, index) => index);

  async function withCopy() {
    const offline = createMemoryOfflineAudio();
    await offline.put("https://pyxis.test/stream/t-1", new Response(bytes, { headers: { "content-type": "audio/webm" } }));
    const { sent, network } = recordingNetwork();
    const deps = { origins, offline, credentials, fetch: network };
    return { deps, sent };
  }

  test("a Range request is answered with a 206 slice from the cache, without the network", async () => {
    const { deps, sent } = await withCopy();
    const response = await handleListeningFetch(
      new Request("https://pyxis.test/stream/t-1", { headers: { range: "bytes=10-19" } }),
      "pyxis-stream",
      deps,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(response.headers.get("content-type")).toBe("audio/webm");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(sent).toHaveLength(0);
  });

  test("no Range gets the whole body; an unsatisfiable Range gets 416", async () => {
    const { deps } = await withCopy();
    const whole = await handleListeningFetch(new Request("https://pyxis.test/stream/t-1"), "pyxis-stream", deps);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect((await whole.arrayBuffer()).byteLength).toBe(100);
    const bad = await handleListeningFetch(
      new Request("https://pyxis.test/stream/t-1", { headers: { range: "bytes=500-" } }),
      "pyxis-stream",
      deps,
    );
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */100");
  });

  test("range parsing covers open, suffix and clamped ranges", () => {
    expect(parseRange(null, 100)).toBeUndefined();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=5-1", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
  });
});
