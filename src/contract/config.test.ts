import { DEFAULT_ASSISTANT_SURFACE_PATH, DEFAULT_TALK_MODEL, DEFAULT_TURN_SOUND_LEAD_MS, loadConfig } from "./config";

const origins = { pyxis: "https://p.test", ossicle: "https://o.test", assistant: "https://a.test",
  voice: "https://v.test", valhalla: "https://r.test", traccar: "https://t.test" };

test("loadConfig fills defaults", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ origins }))) as typeof fetch;
  const config = await loadConfig(fetcher);
  expect(config.turnSoundLeadMs).toBe(DEFAULT_TURN_SOUND_LEAD_MS);
  expect(config.origins.pyxis).toBe("https://p.test");
  expect(config.assistantSurfacePath).toBe(DEFAULT_ASSISTANT_SURFACE_PATH);
  expect(DEFAULT_ASSISTANT_SURFACE_PATH).toBe("/surface");
  expect(config.talkModel).toBe(DEFAULT_TALK_MODEL);
  expect(DEFAULT_TALK_MODEL).toBe("assistant");
});

const withTalkModel = (talkModel: unknown) =>
  (async () => new Response(JSON.stringify({ origins, talkModel }))) as typeof fetch;

test("loadConfig takes a voice-gateway model name for Talk", async () => {
  expect((await loadConfig(withTalkModel("invented-model"))).talkModel).toBe("invented-model");
});

test("loadConfig rejects a Talk model that is not a plain name", async () => {
  for (const bad of ["", "a b", "x&model=y", "a/b", "x".repeat(101), 7]) {
    await expect(loadConfig(withTalkModel(bad)), String(bad)).rejects.toThrow("talkModel");
  }
});

const withSurfacePath = (assistantSurfacePath: unknown) =>
  (async () => new Response(JSON.stringify({ origins, assistantSurfacePath }))) as typeof fetch;

test("loadConfig takes a SurfaceLink path that starts with /", async () => {
  const config = await loadConfig(withSurfacePath("/people/someone/surface"));
  expect(config.assistantSurfacePath).toBe("/people/someone/surface");
});

test("loadConfig rejects a SurfaceLink path that is not a plain path", async () => {
  for (const bad of ["surface", "", "//elsewhere.test/surface", "https://a.test/surface", "/surface?x=1", "/sur face", 42]) {
    await expect(loadConfig(withSurfacePath(bad)), String(bad)).rejects.toThrow("assistantSurfacePath");
  }
});

test("loadConfig rejects a missing origins block", async () => {
  const fetcher = (async () => new Response("{}")) as typeof fetch;
  await expect(loadConfig(fetcher)).rejects.toThrow("origins");
});

test("weather defaults and tank size stays unknown unless configured", async () => {
  const defaults = await loadConfig(withTalkModel("assistant"));
  expect(defaults.weatherUrl).toBe("https://api.open-meteo.com/v1/forecast"); expect(defaults.tankLitres).toBeUndefined();
  const configured = await loadConfig((async () => new Response(JSON.stringify({ origins, weatherUrl: "https://weather.test/forecast", tankLitres: 50 }))) as typeof fetch);
  expect(configured.tankLitres).toBe(50); expect(configured.weatherUrl).toBe("https://weather.test/forecast");
  for (const tankLitres of [0, -1, "50"]) await expect(loadConfig((async () => new Response(JSON.stringify({ origins, tankLitres }))) as typeof fetch)).rejects.toThrow("tankLitres");
});
