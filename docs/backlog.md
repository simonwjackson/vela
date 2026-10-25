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

## Services (track in their own repos)
- **Ossicle /comics accepts cross-site writes.** It has no origin check on POST.
- **Ossicle has a flaky YouTube test.** It fails on "Text file busy".
- **The live voice-gateway accepts any origin.** Add `origins` to its `gateway.toml`.
- **Traccar's trips have no backup.** Its database sits on the routing host's single root disk.
