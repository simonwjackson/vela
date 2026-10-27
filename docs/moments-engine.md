# Moments engine

`src/contract/` defines the messages and the shared calm budgets. The UI owns the program vocabulary and Moment presentation. SurfaceLink sends capabilities immediately after hello. It sends them again when `Settings.moments` changes. Disabled Moments do not send events. `context.update` includes Sound mode at connect and whenever the setting changes.

## Build boundary

Run `npm run schema:generate` after changing `src/ui/moment/vocabulary.ts`. Commit `src/contract/moment-schema.json`. `npm run schema:check` and the schema freshness test compare it with `buildLibrary().toJSONSchema()`. The client reads only that JSON. The Vite build rejects the build-time vocabulary and local zod schema modules in every client chunk. lang-core and its zod dependency may share one lazy Moment runtime chunk. Neither may enter an entry chunk or its static dependencies.

The examples come directly from the UI's `MOMENT_EXAMPLES`. Keep them as program text, not rendered HTML. Nix disables OpenUI telemetry in both the dev shell and the package build.

## Car data

The reader uses the OBDLink CX service FFF0, notifications FFF1 and writes FFF2. The write characteristic carries only the explicit adapter-init and OBD-read allowlist. Mode 04 cannot pass it. One descriptor catalog owns each permitted read, its decoder, cadence and fuel-rate/MAF choice; the poll plan and safety allowlist are derived from that catalog. Notifications are reassembled through the ELM prompt before the next command can start. A reply timeout closes the exchange, because a late reply could belong to the previous command.

The reader polls on a two-second cadence without overlapping exchanges. Fuel is read every 30 seconds. PID 0140 selects fuel rate when supported; otherwise consumption uses MAF. The MAF estimate assumes petrol: air/fuel mass ratio 14.7 and density 745 g/L. It is an estimate, not an ECU Range reading.

`VelaConfig.tankLitres` has no default. Without it, Range is absent. Range integrates distance and fuel over the same rolling 15-minute window. It discards long sample gaps. No movement or no consumption also means no Range.

OsmAnd positions store their original readings in the offline queue. Uploading later does not replace them with current readings. Older queue rows without readings remain readable.

After a disconnect, remembered-device recovery waits 2, 5, 15, 30, then 60 seconds between attempts. Repeated failures keep the 60-second delay. Recovery pauses while the page is hidden and resumes when visible. `CarState.reconnecting` distinguishes automatic recovery from `CarState.connect`, which explicitly needs a user tap. The latter includes a reason when the remembered-device API is unavailable, returns no device, or denies permission. Automatic recovery never opens the device picker. Disposing the engine cancels retry ownership.

## Events and offline behavior

The event detectors identify situations, not GPS updates. They do not consume a situation when SurfaceLink cannot send it. Every context is limited to 1024 UTF-8 bytes. Weather uses a route-anchored sampling grid up to 60 km ahead and the forecast at estimated arrival time. It checks at most every ten minutes for a route. No signal or an invalid forecast produces no event.

The approved contract originally said that arrival summaries came from Traccar. That was corrected during implementation: the arrival summary is **Vela's own current-drive record**, made from its fixes. It includes distance, moving and total time, average moving speed, stationary stops, and the destination. The start uses a nearby Saved place name when available, or “Starting point”. No Traccar report credential is stored on the phone. The personal assistant still uses Traccar for history.

## Test seam

`RecordedGattDevice` replays fragmented ELM replies through the same GATT interface as the browser. Tests cover startup, remembered devices, manual permission, disconnect, timeouts, PID decoding, MIL, stored codes, the read-only allowlist and Range. No test uses Bluetooth or a network connection.

## Shared lifecycle and forecast bindings

Capabilities advertise the contract's `UNTIL_EVENTS` and `maxLifeSeconds` (600), in both the rule fields and their text. The UI imports the same constants; it has no second list of detectable events.

`AppDeps.weather` exposes observable forecast stretches. Each has `fromKm` and `toKm` relative to the car, `kind`, `label`, and `current`. The engine merges adjacent equal conditions. It reprojects the cached forecast on every guidance update without another fetch. Route changes and reset clear incompatible data. Failed refreshes and signal loss retain the last valid forecast for up to three hours from its fetch time. `Weather.fetchedAt` exposes that time, and subscribers are notified when a successful refresh changes it even if the stretches stay the same. Ten minutes is the refresh cadence, not the validity horizon. It does not extrapolate beyond the observed horizon.

Moments bind `weather.now`, `weather.next`, and `weather.change.in`. The spike's `weather.rain.in`, `weather.rain.length`, and `weather.rain.at` also bind to the forecast. `Sequence("weather.stretches")` (also `route.weather`) uses the existing Sequence ticks and labels. Its data keeps normalized interval endpoints, `current`, and `marked` flags for the design engineer's later highlighted-span treatment. No new visual styles are added here.

## Live values sent to the composer

`context.update` carries optional `car`, `stops` and `weather` snapshots. Car values are `fuelPercent`, `rangeKm`, `ambientC`, `mil` and `dtcCount`; absent values are unknown. `stops` contains the next three stops on the way as `name`, `kmAhead` and `arriveAt` (epoch milliseconds). Navigation supplies these from its route timeline in `Guidance.nextVias`, so later stops do not use a distance-only ETA estimate. `weather` contains up to three `stretches` (`fromKm`, `toKm`, `kind`, `label`) and optional `fetchedAt` (epoch milliseconds).

Each connection sends its initial snapshot after hello and capabilities. All later context changes, including Sound mode, trip and playback identity, coalesce to at most one message every ten seconds. Fuel changes by at least one percentage point and Range changes by at least five kilometres are meaningful relative to the last sent snapshot. MIL, code count, whole-degree outside temperature, stop identity, weather condition and forecast fetch time changes are meaningful too. Stop/weather distances changing by one kilometre, or stop ETAs moving by one minute, also qualify. Ordinary guidance/playback progress refreshes at most every 30 seconds while updates arrive. Pending sends are cancelled when the link closes.

The entire serialized UTF-8 context stays below 2048 bytes. It includes no cover URLs or place addresses. Long descriptive strings are shortened to keep the car values and the three stop/weather entries in budget. Empty stop/stretch lists and an empty car object clear values that are no longer known. These are full snapshots, not patches.
