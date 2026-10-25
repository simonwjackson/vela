/**
 * Runtime configuration, fetched from /config.json at startup. The host configuration
 * (the fleet flake) writes it. Nothing personal is ever a constant in this repository.
 */
export interface VelaConfig {
  /** Origins of the driver's own services. Exact origins, no trailing slash. */
  readonly origins: {
    readonly pyxis: string;
    readonly ossicle: string;
    /** The personal assistant: the co-driver's brain and the SurfaceLink endpoint. */
    readonly assistant: string;
    /** voice-gateway: push-to-talk speech in, co-driver speech out. */
    readonly voice: string;
    readonly valhalla: string;
    readonly traccar: string;
  };
  /** Place search. Public Photon by default; swappable (see nav/search). */
  readonly photonUrl: string;
  /** Traccar device identifier this phone reports as (OsmAnd protocol `id`). */
  readonly traccarDeviceId: string;
  /** How early turn sounds start, in milliseconds, to cover Bluetooth delay. */
  readonly turnSoundLeadMs: number;
}

export const DEFAULT_TURN_SOUND_LEAD_MS = 250;

/** Load and validate /config.json. Owned by the shell; engines receive a VelaConfig. */
export async function loadConfig(fetcher: typeof fetch = fetch): Promise<VelaConfig> {
  const res = await fetcher("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Vela could not read /config.json: HTTP ${res.status}`);
  const raw = (await res.json()) as Partial<VelaConfig>;
  if (!raw.origins) throw new Error("Vela config is missing `origins`");
  return {
    origins: raw.origins,
    photonUrl: raw.photonUrl ?? "https://photon.komoot.io",
    traccarDeviceId: raw.traccarDeviceId ?? "vela",
    turnSoundLeadMs: raw.turnSoundLeadMs ?? DEFAULT_TURN_SOUND_LEAD_MS,
  };
}
