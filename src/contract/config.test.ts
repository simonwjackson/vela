import { DEFAULT_TURN_SOUND_LEAD_MS, loadConfig } from "./config";

const origins = { pyxis: "https://p.test", ossicle: "https://o.test", assistant: "https://a.test",
  voice: "https://v.test", valhalla: "https://r.test", traccar: "https://t.test" };

test("loadConfig fills defaults", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ origins }))) as typeof fetch;
  const config = await loadConfig(fetcher);
  expect(config.turnSoundLeadMs).toBe(DEFAULT_TURN_SOUND_LEAD_MS);
  expect(config.origins.pyxis).toBe("https://p.test");
});

test("loadConfig rejects a missing origins block", async () => {
  const fetcher = (async () => new Response("{}")) as typeof fetch;
  await expect(loadConfig(fetcher)).rejects.toThrow("origins");
});
