# Backlog

Open items from the first build's reviews (2026-10-25). They live here until Vela has its own issue tracker.

## Listening
- **Old app files pile up.** Every deploy adds a new set of hashed files to the shell cache, and nothing deletes the old sets. Fix: a cleanup step on `activate`, which needs the build's asset list (`src/sw/worker-fetch.ts`).
- **Seeking re-reads whole files.** Each byte-range request reads the full cached body (`src/sw/range.ts`). Measure on the phone before changing it.
- **No way to pair Pyxis.** If Pyxis asks for pairing, Music shows a plain message, but there is nowhere to enter the code (add `auth.device.pair`).
- **Short offline rewinds can land early.** With no signal, a Books rewind into a window that was not prepared ahead lands at the start of the current window, not the full 2 s back.

## Navigation and Trips
- **Up to 5 s of positions can be lost.** Trips batches its writes, so a tab killed without `pagehide` loses the unsaved fixes (ADR 0008).
- **Turn sounds can be silent after a reload.** A reload that resumes a route has no tap, so the browser blocks audio. Fix: show a "Tap to enable sounds" prompt.
- **Field-test the guidance numbers.** Turn-sound distances, off-route thresholds and the tunnel behaviour (guidance freezes until GPS returns) are estimates.
- **Check the Valhalla turn types.** The maneuver-type mapping comes from documentation and has not been checked against a live server.

## Co-driver (Vela side, not built yet)
- **No Vela-side co-driver client yet.** Build the SurfaceLink client (`wss://assistant.<tailnet>/people/<name>/surface`), the car tools on the phone, push to talk through voice-gateway (`?model=simon`), co-driver speech, the talk button, and the "Hey Vela" wake word (ADR 0009).
- **One directions request at a time.** Vela must not send a second `directions.request` until the first one is answered.

## Design: what the Signal mockups need from the app
The complete Signal design (2026-10-25) draws these states, but the app cannot reach them yet.
- **Route preview.** `start()` routes and starts in one step. The design shows the time, distance and Start before the route begins.
- **Stops on the way.** Adding, removing and reordering a stop on the way has no API, and `Guidance` does not carry stops on the way.
- **Roundabout exit number.** `Stop` has no exit count, so the roundabout glyph cannot show its numeral.
- **A manual Daylight contrast switch.** Settings shows Automatic, On and Off. Only Automatic exists.
- **Speed-limit thresholds.** The design shows the limit when the speed is 5 km/h over it for 3 s. Those numbers are a guess.
- **Co-driver display names.** The assistant gives persona ids only. The design says "Your co-driver" in sentences when no display name exists. The picker descriptions for Navigator, Companion and Guide are placeholders.

## Decisions to make
- **Typing a destination while the car moves.** Nothing says whether search is blocked while moving. The design draws it as allowed.
- **A word for a stop on the way.** CONTEXT.md uses "Stop" for a turn or the Destination; the design's "Add stop" means a fuel or food stop on the way. Pick a separate word.

## Services (track in their own repos)
- **Ossicle /comics accepts cross-site writes.** It has no origin check on POST.
- **Ossicle has a flaky YouTube test.** It fails on "Text file busy".
- **Traccar's trips have no backup.** Its database sits on the routing host's single root disk.
