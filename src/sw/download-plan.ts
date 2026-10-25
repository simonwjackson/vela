/**
 * Which audio Vela keeps offline (ADR 0002). Pure rules; the runner in downloads.ts does the
 * fetching.
 *
 * - Downloads run on Wi-Fi only. When the browser reports a connection type
 *   (`navigator.connection.type`), only "wifi" and "ethernet" allow downloads. When it does
 *   not (no Network Information API, or type "unknown"), the driver's manual flag decides.
 * - Podcasts: every episode in the Ossicle queue, plus the next 3 unplayed episodes. "Next"
 *   means episodes already started (most recently listened first), then the newest
 *   unstarted ones, as Ossicle lists them newest first. Played and finished episodes are
 *   never selected.
 * - Books: the next 3 hours of the current Book's narration, prepared ahead.
 * - Music: every track of every pinned album.
 * - Anything cached that is no longer selected is evicted, so storage stays bounded.
 */
import type { SourceId } from "../contract";

export const NEXT_UNPLAYED_EPISODES = 3;
export const NARRATION_AHEAD_MS = 3 * 60 * 60 * 1000;
/** An episode within this many seconds of its end counts as finished. */
export const FINISHED_TAIL_SEC = 30;

/** The part of `navigator.connection` (Network Information API) the rule reads. */
export interface ConnectionLike {
  readonly type?: string;
}

export type NetworkVerdict =
  | { readonly kind: "allowed"; readonly reason: "wifi" | "manual" }
  | { readonly kind: "blocked"; readonly reason: "metered" | "manual-off" };

export function downloadNetwork(connection: ConnectionLike | undefined, manualWifi: boolean): NetworkVerdict {
  const type = connection?.type;
  if (type === "wifi" || type === "ethernet") return { kind: "allowed", reason: "wifi" };
  if (type !== undefined && type !== "unknown") return { kind: "blocked", reason: "metered" };
  return manualWifi ? { kind: "allowed", reason: "manual" } : { kind: "blocked", reason: "manual-off" };
}

export interface OfflineEpisode {
  readonly id: string;
  /** Absolute audio URL, the same one the player requests. */
  readonly url: string;
  readonly title: string;
  readonly played: boolean;
  readonly positionSec: number;
  readonly durationSec?: number;
  /** When the position was last written, ISO 8601; absent when never started. */
  readonly listenedAt?: string;
}

export interface PodcastCandidates {
  /** The Ossicle queue, in queue order. */
  readonly queue: readonly OfflineEpisode[];
  /** Library episodes, newest first. */
  readonly episodes: readonly OfflineEpisode[];
}

export function isUnplayed(episode: OfflineEpisode): boolean {
  if (episode.played) return false;
  if (episode.durationSec !== undefined && episode.durationSec > 0) {
    return episode.positionSec < episode.durationSec - FINISHED_TAIL_SEC;
  }
  return true;
}

export function selectPodcastDownloads(
  candidates: PodcastCandidates,
  count = NEXT_UNPLAYED_EPISODES,
): readonly OfflineEpisode[] {
  const chosen = new Map<string, OfflineEpisode>();
  for (const episode of candidates.queue) if (!chosen.has(episode.id)) chosen.set(episode.id, episode);
  const unplayed = candidates.episodes.filter((episode) => isUnplayed(episode) && !chosen.has(episode.id));
  const started = unplayed
    .filter((episode) => episode.positionSec > 0)
    .sort((left, right) => (right.listenedAt ?? "").localeCompare(left.listenedAt ?? ""));
  const fresh = unplayed.filter((episode) => episode.positionSec <= 0);
  for (const episode of [...started, ...fresh].slice(0, count)) chosen.set(episode.id, episode);
  return [...chosen.values()];
}

/** One narration window, as prepared by the reader. */
export interface NarrationPiece {
  readonly url: string;
  readonly durationMs: number;
}

/** Take windows in order until they cover `budgetMs` of narration. */
export function selectNarrationAhead(
  pieces: readonly NarrationPiece[],
  budgetMs = NARRATION_AHEAD_MS,
): readonly NarrationPiece[] {
  const chosen: NarrationPiece[] = [];
  let covered = 0;
  for (const piece of pieces) {
    if (covered >= budgetMs) break;
    chosen.push(piece);
    covered += Math.max(0, piece.durationMs);
  }
  return chosen;
}

export interface DownloadTarget {
  readonly source: SourceId;
  /** Absolute URL; also the Cache Storage key. */
  readonly url: string;
  readonly label: string;
  /** Pyxis /stream needs the Bearer token. */
  readonly auth: "pyxis" | "none";
}

export interface DownloadDiff {
  readonly fetch: readonly DownloadTarget[];
  readonly evict: readonly string[];
}

/** What to fetch and what to delete, given what is wanted and what is cached. */
export function diffDownloads(wanted: readonly DownloadTarget[], cached: readonly string[]): DownloadDiff {
  const have = new Set(cached);
  const want = new Set(wanted.map((target) => target.url));
  const seen = new Set<string>();
  const fetchList: DownloadTarget[] = [];
  for (const target of wanted) {
    if (have.has(target.url) || seen.has(target.url)) continue;
    seen.add(target.url);
    fetchList.push(target);
  }
  return { fetch: fetchList, evict: cached.filter((url) => !want.has(url)) };
}
