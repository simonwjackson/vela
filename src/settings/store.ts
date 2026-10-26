/**
 * The SettingsStore: the driver's settings, kept on the phone in localStorage under one key.
 * Settings are preferences, not secrets (ADR 0005), so client storage is the right place.
 *
 * Rules:
 * - A stored value that is missing or invalid falls back to its default, field by field.
 * - `set` rejects invalid values with an Error and changes nothing.
 * - There is one chosen Co-driver. `soundMode` of kind "co-driver" names it too, so the two are
 *   kept equal: choosing a Co-driver updates a "co-driver" Sound mode, and choosing that Sound
 *   mode chooses its Co-driver.
 */
import { CO_DRIVER_ID, type DaylightMode, type Settings, type SettingsStore, type SoundMode } from "../contract";

export const SETTINGS_KEY = "vela.settings";

export const DEFAULT_SETTINGS: Settings = {
  daylight: "auto",
  soundMode: { kind: "sounds" },
  wakeWord: false,
  coDriver: "navigator",
  downloadsOnWifiOnly: true,
};

/** The part of Storage the store uses. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DAYLIGHT: readonly DaylightMode[] = ["auto", "on", "off"];

function isSoundMode(v: unknown): v is SoundMode {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return m.kind === "sounds" || (m.kind === "co-driver" && typeof m.coDriver === "string" && CO_DRIVER_ID.test(m.coDriver));
}

/** Each field of `raw` that is valid, and nothing else. */
function validFields(raw: unknown): Partial<Settings> {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (DAYLIGHT.includes(r.daylight as DaylightMode)) out.daylight = r.daylight as DaylightMode;
  if (isSoundMode(r.soundMode)) out.soundMode = r.soundMode;
  if (typeof r.wakeWord === "boolean") out.wakeWord = r.wakeWord;
  if (typeof r.coDriver === "string" && CO_DRIVER_ID.test(r.coDriver)) out.coDriver = r.coDriver;
  if (typeof r.downloadsOnWifiOnly === "boolean") out.downloadsOnWifiOnly = r.downloadsOnWifiOnly;
  return out;
}

function reconcile(next: Settings, patch: Partial<Settings>): Settings {
  if (patch.soundMode?.kind === "co-driver") return { ...next, coDriver: patch.soundMode.coDriver };
  if (patch.coDriver !== undefined && next.soundMode.kind === "co-driver") {
    return { ...next, soundMode: { kind: "co-driver", coDriver: patch.coDriver } };
  }
  return next;
}

export function createSettingsStore(storage: SettingsStorage | undefined, defaults: Partial<Settings> = {}): SettingsStore {
  const listeners = new Set<(s: Settings) => void>();
  let value: Settings = { ...DEFAULT_SETTINGS, ...validFields(defaults), ...validFields(read()) };

  function read(): unknown {
    try {
      const raw = storage?.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  return {
    get value() {
      return value;
    },
    set(patch) {
      const valid = validFields(patch);
      const bad = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== undefined && !(k in valid));
      if (bad.length > 0) throw new Error(`Invalid setting: ${bad.join(", ")}`);
      const next = reconcile({ ...value, ...valid }, valid);
      if (JSON.stringify(next) === JSON.stringify(value)) return;
      value = next;
      try {
        storage?.setItem(SETTINGS_KEY, JSON.stringify(value));
      } catch {
        // Quota or private mode: the setting holds for this session.
      }
      for (const fn of [...listeners]) fn(value);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
