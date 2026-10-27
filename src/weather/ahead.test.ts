import { guidance } from "../events/fixtures";
import { createWeatherAhead, routeSamples, WEATHER_EVERY_MS, type WeatherChange } from "./ahead";
test("samples along remaining route within 60 km and reports a forecast change at arrival time", async () => {
  let now = 0; let calls = 0; const changes: WeatherChange[] = [];
  const g = guidance(); const samples = routeSamples(g);
  expect(samples.length).toBeGreaterThan(2); expect(samples.at(-1)?.meters).toBeLessThanOrEqual(60000);
  const engine = createWeatherAhead({ url: "https://weather.test/forecast", online: () => true, now: () => now, emit: (e) => changes.push(e),
    fetcher: (async (input) => {
      const url = new URL(String(input)); expect(url.origin).toBe("https://weather.test"); expect(url.searchParams.get("hourly")).toBe("weather_code"); calls++;
      return new Response(JSON.stringify(samples.map((_, i) => ({ hourly: { time: [0, 3600], weather_code: i > 0 ? [61, 61] : [0, 0] } }))));
    }) as typeof fetch,
  });
  await engine.check(g); expect(changes[0]?.to).toBe("rain"); await engine.check(g); expect(calls).toBe(1);
  now = WEATHER_EVERY_MS; await engine.check(g); expect(calls).toBe(2);
});
test("offline and failed or malformed forecasts report nothing", async () => {
  const changes: WeatherChange[] = []; let calls = 0; let online = false;
  const engine = createWeatherAhead({ online: () => online, emit: (e) => changes.push(e), fetcher: (async () => { calls++; throw new Error("No signal"); }) as typeof fetch });
  await engine.check(guidance()); expect(calls).toBe(0); online = true;
  await engine.check(guidance()); expect(calls).toBe(1); expect(changes).toHaveLength(0);
  const malformed = createWeatherAhead({ online: () => true, emit: (e) => changes.push(e), fetcher: (async () => new Response("[null]")) as typeof fetch });
  await malformed.check(guidance()); expect(changes).toHaveLength(0);
});

test("observable stretches merge equal conditions and stay relative to the car between fetches", async () => {
  let clock = 0; let online = true; let calls = 0; let notifications = 0;
  const g = guidance(); const changes: WeatherChange[] = [];
  const engine = createWeatherAhead({ online: () => online, now: () => clock, emit: (change) => changes.push(change),
    fetcher: (async () => { calls++; return new Response(JSON.stringify(routeSamples(g).map((_, i) => ({ hourly: { time: [0, 3600], weather_code: [i === 1 || i === 2 ? 61 : 0, i === 1 || i === 2 ? 61 : 0] } })))); }) as typeof fetch,
  });
  const off = engine.subscribe(() => { notifications++; });
  await engine.check(g);
  expect(engine.stretches).toEqual([
    { fromKm: 0, toKm: 10, kind: "clear", label: "Clear", current: true },
    { fromKm: 10, toKm: 30, kind: "rain", label: "Rain", current: false },
    { fromKm: 30, toKm: 60, kind: "clear", label: "Clear", current: false },
  ]);
  expect(notifications).toBe(1); expect(changes).toHaveLength(1);
  await engine.check(g); expect(notifications).toBe(1);
  online = false; clock = 1000;
  await engine.check({ ...g, metersLeft: 55000 });
  expect(calls).toBe(1); expect(changes).toHaveLength(1);
  expect(engine.stretches).toEqual([
    { fromKm: 0, toKm: 15, kind: "rain", label: "Rain", current: true },
    { fromKm: 15, toKm: 45, kind: "clear", label: "Clear", current: false },
  ]);
  clock = WEATHER_EVERY_MS; await engine.check(g);
  expect(engine.stretches.length).toBeGreaterThan(0); expect(calls).toBe(1);
  expect(engine.fetchedAt).toBe(0);
  off(); const before = notifications; engine.reset(); expect(notifications).toBe(before);
});

test("reset clears bound data and discards an in-flight forecast", async () => {
  const g = guidance(); const changes: WeatherChange[] = [];
  let finish: ((response: Response) => void) | undefined;
  const engine = createWeatherAhead({ online: () => true, emit: (change) => changes.push(change),
    fetcher: (() => new Promise<Response>((resolve) => { finish = resolve; })) as typeof fetch,
  });
  const pending = engine.check(g); engine.reset();
  finish?.(new Response(JSON.stringify(routeSamples(g).map((_, i) => ({ hourly: { time: [0], weather_code: [i ? 61 : 0] } })))));
  await pending; expect(engine.stretches).toEqual([]); expect(changes).toEqual([]);
});

test("malformed forecast conditions never become bound data", async () => {
  const g = guidance();
  for (const code of [999, "rain", null]) {
    const engine = createWeatherAhead({ online: () => true, emit: () => { throw new Error("no event expected"); },
      fetcher: (async () => new Response(JSON.stringify(routeSamples(g).map(() => ({ hourly: { time: [0], weather_code: [code] } }))))) as typeof fetch,
    });
    await engine.check(g); expect(engine.stretches).toEqual([]);
  }
});


test("failed refreshes retain the last forecast until its three-hour validity horizon", async () => {
  const g = guidance();
  for (const failure of ["network", "http", "malformed"]) {
    let clock = 0; let online = true; let calls = 0; const changes: WeatherChange[] = [];
    const engine = createWeatherAhead({ online: () => online, now: () => clock, emit: (change) => changes.push(change),
      fetcher: (async () => {
        if (++calls === 1) return new Response(JSON.stringify(routeSamples(g).map((_, i) => ({ hourly: { time: [0, 3600], weather_code: [i ? 61 : 0, i ? 61 : 0] } }))));
        if (failure === "network") throw new Error("No signal");
        return failure === "http" ? new Response(null, { status: 503 }) : new Response("[null]");
      }) as typeof fetch,
    });
    await engine.check(g); const original = engine.stretches;
    clock = WEATHER_EVERY_MS; await engine.check(g);
    expect(engine.stretches).toEqual(original); expect(engine.fetchedAt).toBe(0); expect(changes).toHaveLength(1);
    online = false; clock = 3 * 60 * 60 * 1000 - 1; await engine.check(g);
    expect(engine.stretches).toEqual(original); expect(calls).toBe(2);
    clock++; await engine.check(g); expect(engine.stretches).toEqual([]); expect(engine.fetchedAt).toBeUndefined(); expect(changes).toHaveLength(1);
  }
});

test("a successful refresh publishes its new fetch time even when the stretches did not change", async () => {
  const g = guidance(); let clock = 0; let notifications = 0;
  const engine = createWeatherAhead({ online: () => true, now: () => clock, emit: () => undefined,
    fetcher: (async () => new Response(JSON.stringify(routeSamples(g).map(() => ({ hourly: { time: [0, 3600], weather_code: [0, 0] } }))))) as typeof fetch,
  });
  engine.subscribe(() => { notifications++; });
  await engine.check(g); expect(engine.fetchedAt).toBe(0);
  clock = WEATHER_EVERY_MS; await engine.check(g); expect(engine.fetchedAt).toBe(WEATHER_EVERY_MS); expect(notifications).toBe(2);
  engine.reset(); expect(engine.fetchedAt).toBeUndefined();
});
