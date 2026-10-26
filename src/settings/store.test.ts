import type { Settings } from "../contract";
import { DEFAULT_SETTINGS, SETTINGS_KEY, type SettingsStorage, createSettingsStore } from "./store";

function memoryStorage(seed?: unknown): SettingsStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(SETTINGS_KEY, JSON.stringify(seed));
  return { values, getItem: (k) => values.get(k) ?? null, setItem: (k, v) => void values.set(k, v) };
}

test("defaults, then persisted changes survive a reload", () => {
  const storage = memoryStorage();
  const store = createSettingsStore(storage);
  expect(store.value).toEqual(DEFAULT_SETTINGS);
  const seen: Settings[] = [];
  store.subscribe((s) => seen.push(s));
  store.set({ daylight: "on", wakeWord: true });
  expect(seen).toHaveLength(1);
  store.set({ daylight: "on" }); // no change, no notification
  expect(seen).toHaveLength(1);
  expect(createSettingsStore(storage).value).toMatchObject({ daylight: "on", wakeWord: true });
});

test("invalid stored fields fall back to their defaults one by one", () => {
  const store = createSettingsStore(memoryStorage({ daylight: "sometimes", wakeWord: true, coDriver: "Bad Id" }));
  expect(store.value).toEqual({ ...DEFAULT_SETTINGS, wakeWord: true });
  expect(createSettingsStore(memoryStorage("not json at all")).value).toEqual(DEFAULT_SETTINGS);
});

test("invalid values are refused and change nothing", () => {
  const store = createSettingsStore(memoryStorage());
  expect(() => store.set({ daylight: "dusk" as never })).toThrow("daylight");
  expect(() => store.set({ coDriver: "../x" })).toThrow("coDriver");
  expect(store.value).toEqual(DEFAULT_SETTINGS);
});

test("one chosen Co-driver: Sound mode and coDriver stay equal", () => {
  const store = createSettingsStore(memoryStorage());
  store.set({ soundMode: { kind: "co-driver", coDriver: "guide" } });
  expect(store.value.coDriver).toBe("guide");
  store.set({ coDriver: "companion" });
  expect(store.value.soundMode).toEqual({ kind: "co-driver", coDriver: "companion" });
  store.set({ soundMode: { kind: "sounds" } });
  store.set({ coDriver: "navigator" });
  expect(store.value.soundMode).toEqual({ kind: "sounds" });
});

test("start-up defaults apply only where nothing is stored", () => {
  expect(createSettingsStore(memoryStorage(), { downloadsOnWifiOnly: false }).value.downloadsOnWifiOnly).toBe(false);
  const stored = memoryStorage({ downloadsOnWifiOnly: true });
  expect(createSettingsStore(stored, { downloadsOnWifiOnly: false }).value.downloadsOnWifiOnly).toBe(true);
});
