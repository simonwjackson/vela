# Vela UI: the Signal design

One app mount draws every Signal state from the engines' state.

```
engines ─┐
ui state ├─ app/screen.ts screen()   pure: which of the 68 states, and its data (unit-tested)
memory  ─┘        │
                  app/render.ts      the model as elements (view/parts.ts components)
                  core/morph.ts      patch the live DOM in place (focus, drafts, scroll survive)
                  view/fit.ts        measured adaptations: hero step-down, trip-bar stacking,
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
| `dev/` | Fakes of every contract interface, fixtures, and the 68 scenarios for `dev.html` |

## Look at any state

`npm run dev`, then open `/dev.html?state=near&stress=1&daylight=1`. Without `state` the page lists
all of them. Arrow keys step through states; S and D flip worst-case data and Daylight contrast.
`dev.html` is not a build input, so it stays out of the production bundle.

## Rules the code keeps

- Layout is a function of the frame's size. Resize, fold and the keyboard re-plan; nothing reads the device.
- Every target is 56 px; events are delegated (`data-action`, `data-field`, `data-talk`).
- Data goes into the DOM as text only. Only the static icon strings are markup.
