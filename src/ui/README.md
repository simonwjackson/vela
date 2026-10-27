# Vela UI: the Signal design

One app mount draws every Signal state from the engines' state.

```
engines ─┐
ui state ├─ app/screen.ts screen()   pure: which of the 68 states, and its data (unit-tested)
memory  ─┘        │
                  app/render.ts      the model as elements (view/parts.ts components)
                  core/morph.ts      patch the live DOM in place (focus, drafts, scroll survive)
                  view/fit.ts        measured adaptations: hero step-down, the compact stage,
                                     glyph-only chips, compact card, optional rows, the peek row
```

| Path | What it is |
|---|---|
| `app/mount.ts` | `mount(root, deps: AppDeps, options?)`, and `mountBootError(root, message)` for a failed config |
| `app/screen.ts` | The view mapping and its thresholds (`NOW_M`, `FAR_M`, `THEN_M`, `GPS_LOST_MS`, …) |
| `app/contract.ts` | The one import point for contract types: re-exports `src/contract` and the Downloads types |
| `core/plan.ts` | `plan(w, h)`: flow and fluid sizes from the frame's size |
| `core/format.ts`, `core/icons.ts` | Text rules (short road, clean title, durations) and the icon set |
| `styles/` | Tokens, Daylight contrast, components (`system.css`) and each area's parts |
| `moment/` | Moments (ADR 0010, 0011 step 1): the vocabulary, the renderer, the calm rules gate and the lifecycle; see below |
| `dev/` | Fakes of every contract interface, fixtures, the 68 scenarios for `dev.html`, the Moment scenes for `dev-moments.html`, and `capture.mjs`/`pixdiff.mjs` |

## Look at any state

`npm run dev`, then open `/dev.html?state=near&stress=1&daylight=1`. Without `state` the page lists
all of them. Arrow keys step through states; S and D flip worst-case data and Daylight contrast.
`dev.html` is not a build input, so it stays out of the production bundle.
`&update=ready|checking|current` sets the update state (the chip, and Settings' version row);
`&check=current|updated|failed` is what a tap on "Check for updates" finds.

## Postures

`core/postures.ts` is the list every layout change is checked at: `um` 1000×755 (the Fold 8
unfolded in landscape, as an installed PWA, measured from a screenshot), then the four guesses from
the Signal brief (`ul` 932×553, `up` 704×783, `fl` 711×374, `fp` 475×638). The capture tool takes a
posture id or `all` in place of a size, and `dev-moments.html?posture=` picks from the same list.

```
node src/ui/dev/capture.mjs /tmp/shots . "/dev.html?state=noroute@all=noroute"   # noroute-um.png …
node src/ui/dev/frame-check.mjs .        # every state at every posture: nothing paints off screen
```

`/dev.html?state=noroute&shelf=one&places=recent1` draws the driver's first report from the Fold:
one Source on the Shelf, one Recent destination.

## Rules the code keeps

- Layout is a function of the frame's size. Resize, fold and the keyboard re-plan; nothing reads the device.
- Every target is 56 px; events are delegated (`data-action`, `data-field`, `data-talk`).
- Data goes into the DOM as text only. Only the static icon strings are markup.

## Moments

A Moment arrives over SurfaceLink (`deps.moments`), passes the gate, and shows by its lifecycle.
The mount draws every screen through `moment/render.ts`: with no Moment the tree is
`Screen([Frame()])`, which is `renderScreen()` whole, so Vela looks as it did before Moments.

| File | What it is |
|---|---|
| `moment/keys.ts` | Plain data: the bound keys, glyphs, action steps and until events |
| `moment/vocabulary.ts` | `buildLibrary()`: the OpenUI library (zod). Build time and tests only; `npm run schema:generate` writes `src/contract/moment-schema.json` from it |
| `moment/examples.ts` | `MOMENT_EXAMPLES`: the 5 approved states as Frame programs, then 3 composed shapes |
| `moment/program.ts` | Parse with the generated schema, evaluate to plain parts, `patch` (mergeStatements) |
| `moment/gate.ts` | The calm rules (`MOMENT_RULES`), Signal's part rules, the bound data, then the render probe at the four postures; returns `UiProblem[]` |
| `moment/load.ts`, `engine.ts` | lang-core (and the zod it runs at load) and the gate, in one lazy chunk |
| `moment/data.ts` | The bound values, from the mapping's input, the Screen and the car |
| `moment/render.ts`, `reflow.ts` | The tree as Vela's parts; reflow (space, then text, then Optional blocks) and the word count |
| `moment/lifecycle.ts` | Pure: waiting (the chip, a turn under 1 km), showing, gone; until, ✕, "never mind" |

Look at it: `npm run dev`, then `/dev-moments.html`. Pick a Moment, a posture, worst case and
Daylight; the side panel sends `moment.show`, passes the turn, fires the until event, says "never
mind", and shows what Vela reported. `?bare=1&scene=fuel&phase=waiting|screen|details|faded|settings|car|car-end`
opens one phase for captures:

```
node src/ui/dev/capture.mjs /tmp/shots . "/dev-moments.html?bare=1&scene=fuel&phase=screen@711x374=fuel"
node src/ui/dev/pixdiff.mjs /tmp/before /tmp/after   # pixel for pixel, two folders of captures
```
