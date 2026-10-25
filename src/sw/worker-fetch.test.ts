import { createMemoryCredentialStore } from "../sources/pyxis-credentials";
import { createMemoryOfflineAudio } from "./offline-cache";
import { createWorkerFetch, shellRequestKind } from "./worker-fetch";

const scope = "https://vela.test";
const config = {
  origins: {
    pyxis: "https://pyxis.test",
    ossicle: "https://ossicle.test",
    assistant: "https://a.test",
    voice: "https://v.test",
    valhalla: "https://r.test",
    traccar: "https://t.test",
  },
};

/** A network with a signal switch. Records every URL it was asked for. */
function network(routes: Record<string, () => Response>) {
  const state = { online: true, asked: [] as string[], headers: [] as Headers[] };
  const fetcher: typeof fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(String(input));
    state.asked.push(request.url);
    state.headers.push(request.headers);
    if (!state.online) throw new TypeError("Failed to fetch");
    const route = routes[new URL(request.url).pathname];
    return route === undefined ? new Response("not found", { status: 404 }) : route();
  };
  return { state, fetcher };
}

function setup(routes: Record<string, () => Response> = {}) {
  const net = network({
    "/": () => new Response("<html>vela v2</html>", { headers: { "content-type": "text/html" } }),
    "/config.json": () => Response.json(config),
    "/assets/index-abc123.js": () => new Response("console.log(1)"),
    "/stream/t-1": () => new Response("fresh"),
    ...routes,
  });
  const shell = createMemoryOfflineAudio();
  const offline = createMemoryOfflineAudio();
  const deps = {
    scopeOrigin: scope,
    shell,
    offline,
    credentials: createMemoryCredentialStore({ token: "device-token-test", deviceId: "dev-car", accountId: "default" }),
    fetch: net.fetcher,
    networkTimeoutMs: 50,
  };
  return { net, shell, offline, deps, handle: createWorkerFetch(deps) };
}

const navigation = (url = `${scope}/`) => {
  const request = new Request(url);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
};

describe("which requests the worker handles", () => {
  test("same-origin navigations, /config.json and /assets; never /sw.js or other origins", () => {
    const kind = (url: string, mode: RequestMode = "cors") => shellRequestKind({ url, method: "GET", mode }, scope);
    expect(kind(`${scope}/`, "navigate")).toBe("navigation");
    expect(kind(`${scope}/config.json`)).toBe("config");
    expect(kind(`${scope}/assets/index-abc123.js`)).toBe("asset");
    expect(kind(`${scope}/sw.js`)).toBeUndefined();
    expect(kind("https://elsewhere.test/assets/x.js")).toBeUndefined();
    expect(shellRequestKind({ url: `${scope}/config.json`, method: "POST", mode: "cors" }, scope)).toBeUndefined();
  });

  test("other requests are left to the browser", () => {
    const { handle } = setup();
    expect(handle(new Request(`${scope}/sw.js`))).toBeUndefined();
    expect(handle(new Request("https://photon.test/api?q=x"))).toBeUndefined();
  });
});

describe("app shell offline", () => {
  test("a navigation uses the network and keeps the last good page for a dead zone", async () => {
    const { handle, net } = setup();
    expect(await (await handle(navigation()))?.text()).toBe("<html>vela v2</html>");
    net.state.online = false;
    // Any in-app path falls back to the one stored page.
    const offline = await handle(navigation(`${scope}/drive`));
    expect(offline?.status).toBe(200);
    expect(await offline?.text()).toBe("<html>vela v2</html>");
  });

  test("a navigation with no signal and no stored page answers 503", async () => {
    const { handle, net } = setup();
    net.state.online = false;
    expect((await handle(navigation()))?.status).toBe(503);
  });

  test("a slow network counts as no signal", async () => {
    const { shell } = setup();
    await shell.put(`${scope}/`, new Response("stored page"));
    const slow = createWorkerFetch({
      ...setup().deps,
      shell,
      fetch: () => new Promise<Response>(() => undefined),
      networkTimeoutMs: 20,
    });
    expect(await (await slow(navigation()))?.text()).toBe("stored page");
  });

  test("/config.json is network first with the last good copy as fallback", async () => {
    const { handle, net } = setup();
    expect(await (await handle(new Request(`${scope}/config.json`)))?.json()).toEqual(config);
    net.state.online = false;
    expect(await (await handle(new Request(`${scope}/config.json`)))?.json()).toEqual(config);
  });

  test("hashed assets are cache first, filled on first use", async () => {
    const { handle, net } = setup();
    const url = `${scope}/assets/index-abc123.js`;
    expect(await (await handle(new Request(url)))?.text()).toBe("console.log(1)");
    net.state.online = false;
    const asked = net.state.asked.length;
    expect(await (await handle(new Request(url)))?.text()).toBe("console.log(1)");
    expect(net.state.asked.length).toBe(asked);
  });

  test("a missing asset is not cached", async () => {
    const { handle, shell } = setup();
    expect((await handle(new Request(`${scope}/assets/missing.js`)))?.status).toBe(404);
    expect(await shell.keys()).toEqual([]);
  });
});

describe("a worker restarted in a dead zone", () => {
  test("serves a downloaded copy by URL before it knows the Service origins", async () => {
    const { handle, net, offline } = setup();
    net.state.online = false;
    await offline.put("https://pyxis.test/stream/t-1", new Response(new Uint8Array(20)));
    const response = await handle(new Request("https://pyxis.test/stream/t-1", { headers: { range: "bytes=0-9" } }));
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toBe("bytes 0-9/20");
  });

  test("takes the origins from the last good config when /config.json is unreachable", async () => {
    const { deps, shell } = setup();
    await shell.put(`${scope}/config.json`, Response.json(config));
    const restarted = createWorkerFetch({
      ...deps,
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === "/config.json") throw new TypeError("Failed to fetch");
        const request = input instanceof Request ? input : new Request(url);
        return new Response(request.headers.get("authorization"));
      },
    });
    const response = await restarted(new Request("https://pyxis.test/stream/t-2"));
    expect(await response?.text()).toBe("Bearer device-token-test");
  });
});
