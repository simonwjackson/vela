/**
 * The car's Pyxis device credentials: the device token from `auth.device.claim`, which Pyxis
 * returns exactly once, and the id of the session the car hosts.
 *
 * Storage seam: Cache Storage under one synthetic key. Cache Storage is the one store both the
 * page and the service worker can read, and the service worker needs the token to add the
 * Bearer header to `/stream` requests. This follows Pyxis's own client, which keeps its
 * stream credentials in Cache Storage (pyxis clients/app/src/pwa/service-worker.ts).
 * The token never enters the repository, logs or URLs (ADR 0005).
 */

export interface PyxisCredentials {
  readonly token: string;
  readonly deviceId: string;
  readonly accountId: string;
  readonly sessionId?: string;
}

export interface PyxisCredentialStore {
  read(): Promise<PyxisCredentials | undefined>;
  write(credentials: PyxisCredentials): Promise<void>;
  clear(): Promise<void>;
}

export const CREDENTIALS_CACHE = "vela-pyxis-device-v1";
export const CREDENTIALS_KEY = "https://vela-pyxis.invalid/device";

export function parseCredentials(value: unknown): PyxisCredentials | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.token !== "string" || typeof record.deviceId !== "string" || typeof record.accountId !== "string") {
    return undefined;
  }
  return {
    token: record.token,
    deviceId: record.deviceId,
    accountId: record.accountId,
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
  };
}

export function createCacheCredentialStore(storage: CacheStorage): PyxisCredentialStore {
  const open = () => storage.open(CREDENTIALS_CACHE);
  return {
    async read() {
      const response = await (await open()).match(CREDENTIALS_KEY);
      if (response === undefined) return undefined;
      return parseCredentials(await response.json().catch(() => undefined));
    },
    async write(credentials) {
      await (await open()).put(
        CREDENTIALS_KEY,
        new Response(JSON.stringify(credentials), { headers: { "content-type": "application/json" } }),
      );
    },
    async clear() {
      await (await open()).delete(CREDENTIALS_KEY);
    },
  };
}

export function createMemoryCredentialStore(initial?: PyxisCredentials): PyxisCredentialStore {
  let saved = initial;
  return {
    read: async () => saved,
    async write(credentials) {
      saved = credentials;
    },
    async clear() {
      saved = undefined;
    },
  };
}
