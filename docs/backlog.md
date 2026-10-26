# Backlog

Open items from the first build's reviews (2026-10-25). They live here until Vela has its own issue tracker.

## Listening
- **Old app files pile up.** Every deploy adds a new set of hashed files to the shell cache, and nothing deletes the old sets. Fix: a cleanup step on `activate`, which needs the build's asset list (`src/sw/worker-fetch.ts`).
- **Seeking re-reads whole files.** Each byte-range request reads the full cached body (`src/sw/range.ts`). Measure on the phone before changing it.
- **No way to pair Pyxis.** If Pyxis asks for pairing, Music shows a plain message, but there is nowhere to enter the code (add `auth.device.pair`).
- **Short offline rewinds can land early.** With no signal, a Books rewind into a window that was not prepared ahead lands at the start of the current window, not the full 2 s back.

## Navigation and Trips
- **Up to 5 s of positions can be lost.** Trips batches its writes, so a tab killed without `pagehide` loses the unsaved fixes (ADR 0008).
- **Turn sounds can be silent after a reload.** A reload that resumes a route has no tap, so the browser blocks audio. `AppStatus.soundBlocked` and `unblockSound()` now report it; the Signal UI must show the prompt.
- **Field-test the guidance numbers.** Turn-sound distances, off-route thresholds and the tunnel behaviour (guidance freezes until GPS returns) are estimates.
- **Check the Valhalla turn types.** The maneuver-type mapping comes from documentation and has not been checked against a live server.

## Co-driver
- **Vela sends no `trip.ended` and no `directions.request` yet.** SurfaceLink carries car tools and context only. When directions are added: one `directions.request` at a time; do not send a second until the first is answered.
- **No live words while the driver talks.** `TalkState.listening.transcript` stays empty: voice-gateway transcribes a push-to-talk turn only after the commit. The words appear in `thinking.said`.
- **Speaking progress is approximate.** The answer streams in, so `speaking.progress` is the share heard of what has arrived so far.
- **Field-test the hands-free turn.** The wake threshold (0.25), the silence level (10 dB over the road noise) and the 1.2 s end of turn are estimates (ADR 0009).
- **`playback.control` refuses `playItem`.** Items come from `playback.find`; the assistant cannot invent one.

## Design: what the Signal mockups need from the app
The complete Signal design (2026-10-25) draws these states, but the app cannot reach them yet.
- **Reordering stops on the way.** Adding and removing are built (`addStop`, `removeStop`); reordering is not.
- **Speed-limit thresholds.** The design shows the limit when the speed is 5 km/h over it for 3 s. Those numbers are a guess.
- **Co-driver display names.** The assistant gives persona ids only. Vela shows Navigator, Companion and Guide for the three default ids and "Your co-driver" for any other (`src/codriver/names.ts`). The picker descriptions are placeholders.

## Decisions to make
- **Typing a destination while the car moves.** Nothing says whether search is blocked while moving. The design draws it as allowed.
- **A word for a stop on the way.** CONTEXT.md uses "Stop" for a turn or the Destination; the design's "Add stop" means a fuel or food stop on the way. Pick a separate word.

## Services (track in their own repos)
- **Ossicle /comics accepts cross-site writes.** It has no origin check on POST.
- **Ossicle has a flaky YouTube test.** It fails on "Text file busy".
- **Traccar's trips have no backup.** Its database sits on the routing host's single root disk.
