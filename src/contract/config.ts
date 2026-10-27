/**
 * Runtime configuration, fetched from /config.json at startup. The host configuration
 * (the fleet flake) writes it. Nothing personal is ever a constant in this repository.
 */
export interface VelaConfig {
  readonly weatherUrl?: string;
  /** No default: unknown tank size means no Range. */
  readonly tankLitres?: number;
  /** Origins of the driver's own services. Exact origins, no trailing slash. */
  readonly origins: {
    readonly pyxis: string;
    readonly ossicle: string;
    /** The personal assistant: the Co-driver itself, and the SurfaceLink endpoint. */
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
  /**
   * Path of the SurfaceLink endpoint on `origins.assistant`; it starts with "/". The assistant
   * may serve one surface per person (for example `/people/<name>/surface`), which is personal,
   * so the host configuration sets it. Optional; loadConfig fills DEFAULT_ASSISTANT_SURFACE_PATH.
   */
  readonly assistantSurfacePath?: string;
  /**
   * The voice-gateway model (`?model=`) that Talk opens: the gateway's name for the personal
   * assistant. Optional; loadConfig fills DEFAULT_TALK_MODEL.
   */
  readonly talkModel?: string;
}

/** A VelaConfig as loadConfig returns it: every default filled, so engines never restate one. */
export type LoadedConfig = VelaConfig & Required<Pick<VelaConfig, "assistantSurfacePath" | "talkModel" | "weatherUrl">>;

export const DEFAULT_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
export const DEFAULT_TURN_SOUND_LEAD_MS = 250;
export const DEFAULT_ASSISTANT_SURFACE_PATH = "/surface";
/** The model name voice-gateway's README documents for the personal assistant. */
export const DEFAULT_TALK_MODEL = "assistant";

/** Load and validate /config.json. Owned by the shell; engines receive a VelaConfig. */
export async function loadConfig(fetcher: typeof fetch = fetch): Promise<LoadedConfig> {
  const res = await fetcher("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Vela could not read /config.json: HTTP ${res.status}`);
  const raw = (await res.json()) as Partial<VelaConfig>;
  if (!raw.origins) throw new Error("Vela config is missing `origins`");
  const surfacePath = raw.assistantSurfacePath ?? DEFAULT_ASSISTANT_SURFACE_PATH;
  // One path, no scheme, host, query or fragment: it is appended to an origin.
  if (typeof surfacePath !== "string" || !/^\/[^?#\s]*$/.test(surfacePath) || surfacePath.startsWith("//")) {
    throw new Error("Vela config `assistantSurfacePath` must be a path starting with /, such as /surface");
  }
  const talkModel = raw.talkModel ?? DEFAULT_TALK_MODEL;
  // One query value: letters, digits, dot, dash, underscore and colon, as gateway model names use.
  if (typeof talkModel !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(talkModel)) {
    throw new Error("Vela config `talkModel` must be a voice-gateway model name, such as assistant");
  }
  const weatherUrl = raw.weatherUrl ?? DEFAULT_WEATHER_URL;
  try {
    if (typeof weatherUrl !== "string") throw new Error("not text");
    const url = new URL(weatherUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("not HTTP");
  } catch { throw new Error("Vela config `weatherUrl` must be an HTTP URL without credentials"); }
  if (raw.tankLitres !== undefined && (!Number.isFinite(raw.tankLitres) || raw.tankLitres <= 0)) throw new Error("Vela config `tankLitres` must be positive");
  return {
    weatherUrl,
    ...(raw.tankLitres !== undefined ? { tankLitres: raw.tankLitres } : {}),
    origins: raw.origins,
    photonUrl: raw.photonUrl ?? "https://photon.komoot.io",
    traccarDeviceId: raw.traccarDeviceId ?? "vela",
    turnSoundLeadMs: raw.turnSoundLeadMs ?? DEFAULT_TURN_SOUND_LEAD_MS,
    assistantSurfacePath: surfacePath,
    talkModel,
  };
}
