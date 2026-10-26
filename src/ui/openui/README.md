# Signal as an OpenUI language (spike, dev-only)

The co-driver composes whole Vela screens as [OpenUI Lang](https://openui.com/docs/openui-lang)
programs. The language is Signal's parts and nothing else, so any program it can say looks like
Signal. Determinism comes from the language: no prop sets colour, size, font, spacing or
position, and live values are bound by key, never typed.

```
root = Screen(stage)
stage = Stage(answer, fuel, trip)
answer = Hero("nav.next")
fuel = Card([facts, stations], "Fuel is low")
facts = Facts([Fact("Range", "car.range"), Fact("To go", "trip.distance")])
stations = List([PlaceRow("suggest.0", @AddStop("suggest.0")), PlaceRow("suggest.1", @AddStop("suggest.1"))])
trip = TripRow()
```

Look at it: `npm run dev`, then `/openui.html` (on the phone: the dev server's address).
Pick a program, a posture, Stress and Daylight; the program and the gate's verdict show beside it.
`openui.html` is not a build input, so none of this is in `dist`.

**Install:** `@openuidev/lang-core` sends telemetry from its postinstall. Install with
`OPENUI_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 npm ci`. The Nix build sets both.

## Files

| File | What it is |
|---|---|
| `vocabulary.ts` | The components and actions (zod, `component: null`). The descriptions are the model's prompt. |
| `program.ts` | `read()`: lang-core's parser + `evaluateRoot`; `patch()`: `mergeStatements` |
| `render.ts` | `draw(host, tree, live)`: the tree as Vela's real parts (`app/render.ts`, `view/parts.ts`), then `plan()`, `morph()`, `fit()` |
| `live.ts` | The dev fakes, set up by a scene, ticking once a second; the bound values (`textOf`, `figureOf`, `placeOf`, `mediaOf`) |
| `scenes.ts` | The 5 approved states (the dev page's own scenarios) and the 4 novel contexts |
| `gate.ts` | `gate(program, scene)`: language checks, Signal's rules, then a render probe at the four postures |
| `prompt.ts` | `systemPrompt()` / `editPrompt()` (`generateSystemPrompt`), `contextMessage()` |
| `programs/` | The programs: 5 by hand, the novel ones by the model (`compose-log.json` has every attempt) |
| `page.ts`, `/openui.html` | The page; `?bare=1&still=1` for captures, `?api=1` for the compose tool |
| `tools/openui-compose.mjs` | Asks the model for the novel screens, gates them, feeds problems back once, saves them |
| `tools/openui-capture.mjs` | Captures: each approved program beside `dev.html` and the mockup; the novel screens at 4 postures |

## The frame

`Screen(stage, chip?)` → `Stage(primary, secondary?, base?)`: the answer, the card slot and the
base row of the Signal brief. Stage takes Vela's grid, so `plan(w, h)` decides row or column flow
exactly as in the app. `Stack` and `Split` group parts inside one slot (Split goes side by side
when its slot holds two 260 px columns, a container query). The system always adds the top row
(clock, settings, chip slot) and Talk at the trailing end of the base row.

## Binding: keys, not `$variables`

Bound parts take a key from an enum (`Hero("car.range")`, `Fact("Arrive", "trip.eta")`,
`PlaceRow("suggest.0")`, `MediaRow("media.next")`). The host owns the value and redraws each tick;
the program never changes. lang-core `$variables` were not used: they are program state with a
default the model writes, and `@Set` lets the program change them, which is the opposite of host
data the model must not type. A key enum is also checked by the schema and listed in the prompt.

## Data the contract does not have yet

The novel scenes bind `car.range`, `weather.now|next`, `suggest.N` (places ahead with a detour),
`media.next` (a recommendation) and `trip.driven|time|avg|stops` (a finished drive). They are
stand-ins in `live.ts` (`Extras`), not contract fields.
