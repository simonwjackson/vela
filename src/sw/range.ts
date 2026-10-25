/**
 * Range responses from a cached full body. A media element seeks with Range requests, so a
 * cached copy must answer with real 206 slices or seeking stalls offline.
 */

export interface ByteRange {
  readonly start: number;
  /** Inclusive. */
  readonly end: number;
}

/**
 * Parse a single-range `Range` header against a known size. `undefined` means no header
 * (serve the whole body); "invalid" means malformed or unsatisfiable (serve 416).
 */
export function parseRange(header: string | null, size: number): ByteRange | "invalid" | undefined {
  if (header === null || header.trim() === "") return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || size <= 0) return "invalid";
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "" && endText === "") return "invalid";
  if (startText === "") {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start >= size) return "invalid";
  if (endText === "") return { start, end: size - 1 };
  const end = Number(endText);
  if (!Number.isSafeInteger(end) || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

export async function rangeResponse(cached: Response, rangeHeader: string | null): Promise<Response> {
  const blob = await cached.blob();
  const type = cached.headers.get("content-type") ?? "application/octet-stream";
  const range = parseRange(rangeHeader, blob.size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${blob.size}` } });
  }
  if (range === undefined) {
    return new Response(blob, {
      status: 200,
      headers: { "content-type": type, "content-length": String(blob.size), "accept-ranges": "bytes" },
    });
  }
  const slice = blob.slice(range.start, range.end + 1, type);
  return new Response(slice, {
    status: 206,
    headers: {
      "content-type": type,
      "content-length": String(slice.size),
      "content-range": `bytes ${range.start}-${range.end}/${blob.size}`,
      "accept-ranges": "bytes",
    },
  });
}
