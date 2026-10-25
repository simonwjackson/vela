/**
 * How Vela settles a revisioned position Conflict from Ossicle (Podcasts) or the reader
 * behind Ossicle (Books).
 *
 * What the Services already do (ossicle services/ossicle/src/position.rs `Positions::write`,
 * comics services/comics/src/position.rs `write_book_position`):
 * - A write whose `baseRevision` is the stored revision is accepted and the revision advances.
 * - A stale write within POSITION_EQUIVALENCE_SECONDS (5 s) of the stored seconds is
 *   "the same listening moment": it is answered `accepted` with the stored position,
 *   unchanged. For Books the equivalent check is the locator's restore authority.
 * - Any other stale write is a `conflict` carrying `theirs` (the stored position, the newest
 *   one on the Service) and `yours`.
 * - `force: true` wins only when `baseRevision` equals the stored revision; a stale force
 *   meets a new conflict. A force without a revision is an error.
 *
 * Vela's rule on a conflict: **theirs wins (it is the newest), unless the driver's local
 * play is ahead of it.** When the car is ahead, Vela writes again with `force: true` and
 * `baseRevision` set to their revision, so the driver never loses listening done in the car.
 * When theirs is ahead (or equal), Vela adopts their position and revision and moves the
 * player there. A forced write that meets yet another conflict is settled the same way,
 * at most three times, then left for the next sync.
 */

export type ConflictResolution = { readonly kind: "keepMine" } | { readonly kind: "takeTheirs" };

/**
 * `theirs` and `yours` are progress in the same unit: seconds for Podcasts, whole-book
 * progression for Books.
 */
export function resolvePositionConflict(theirs: number, yours: number): ConflictResolution {
  return yours > theirs ? { kind: "keepMine" } : { kind: "takeTheirs" };
}

export const MAX_CONFLICT_ROUNDS = 3;
