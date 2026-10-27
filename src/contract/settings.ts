/** The driver's settings, kept on the phone. Words follow CONTEXT.md. */
import type { CoDriverId, SoundMode } from "./surface";

export type DaylightMode = "auto" | "on" | "off";
export interface Settings { moments: boolean; daylight: DaylightMode; soundMode: SoundMode; wakeWord: boolean; coDriver: CoDriverId; downloadsOnWifiOnly: boolean }
export interface SettingsStore { readonly value: Settings; set(patch: Partial<Settings>): void; subscribe(fn: (s: Settings) => void): () => void }
