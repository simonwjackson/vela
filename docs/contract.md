# Build contract

This is what every builder works against. The TypeScript in `src/contract/` is the binding part. This page says who owns what and how the pieces meet. The words come from `CONTEXT.md`. The decisions come from `docs/adr/`.

> The visual design is not decided. Build a deliberately plain reference UI: system font, no styling effort. Put the effort into the engines' public APIs, so the real design can be drawn on top of them later.

## Ownership

| Area | Owner | Paths |
|---|---|---|
| Contract, config, shell | parent | `src/contract/`, `src/main.ts`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `flake.nix`, `nix/` |
| Listening | vela-audio | `src/audio/`, `src/sources/`, `src/sw/`, `src/ui/listen/` |
| Navigation and Trips | vela-nav | `src/nav/`, `src/trips/`, `src/ui/drive/` |

Rules:

- Do not edit a path you do not own. If the contract is wrong or missing something, stop and ask the parent. Do not work around it.
- Do not add npm dependencies. Both Vela builders share `package.json`, so a new dependency means a merge conflict. If one is truly needed, ask the parent.
- Each builder exports a `mount(root: HTMLElement, deps): () => void` from `src/ui/<area>/mount.ts`. The parent wires both into `src/main.ts` after merging.
- Listening and navigation meet only through the contract: `Listening.yieldForTurnSound` and `NavEngine.onTurnSound`. Neither imports the other's internals.
- Every network call takes its origin from `VelaConfig`. No hostnames, tailnet names or personal places in code, tests or fixtures (ADR 0005). Test fixtures use `*.test` origins and invented places.
- Tests use fakes for Pyxis, Ossicle, Valhalla, Photon and Traccar. No test touches the network.

## Services, as the code expects them

| Service | What Vela calls | Notes |
|---|---|---|
| Ossicle | `POST /rpc` (`library.episodes`, `podcast.episodes`, `queue.list`, `position.list`, `position.write`, `position.markPlayed`, `episode.chapters`, `episode.sponsorSegments`), `GET /audio/:id`, `GET /covers/:id`, `/comics/*` for Books (`books.list`, `narration.timeline`, `narration.prepare`, `book.position.read/write`) | Cross-origin after its allowlist change (ADR 0001). Position writes carry `baseRevision` and `deviceId`, and may return `Conflict`. |
| Pyxis | `POST /rpc` (`auth.device.claim`, `session.create`, `session.command.run`, `library.albums.list`, `source.album.get`, `source.search.run`, `listen.events.append`; every call but the auth ones sends `x-pyxis-contract`), `GET /realtime` WebSocket, `GET /stream/:trackId` | Bearer token. The service worker adds it to `/stream` requests. The car hosts its own session (ADR 0003). |
| Valhalla | `POST /route` with `costing: auto`, `directions_options.units: kilometers` | The whole Route and every instruction are fetched once at start, then guidance runs offline (ADR 0002). |
| Photon | `GET /api?q=…&lat=…&lon=…` | Behind one swappable function. |
| Traccar | OsmAnd protocol: `GET /?id=…&lat=…&lon=…&timestamp=…&speed=…` on the OsmAnd port | Queued offline, sent with original timestamps (ADR 0008). |
| Assistant | `WebSocket <assistantSurfacePath>` on `origins.assistant` (default `/surface`), the SurfaceLink protocol in `src/contract/surface.ts` | Car tools run in Vela. The assistant side is built in its own repo. The assistant serves one surface per person, so the host configuration sets the path in `/config.json`; it starts with `/`, and the person's name never goes in this repository. |
| voice-gateway | `WebSocket /v1/realtime?model=<talkModel>` (OpenAI Realtime subset, pcm16 at 24 kHz), push to talk; `talkModel` comes from `/config.json` (default `assistant`), since the gateway's name for the driver's assistant is personal | The Co-driver's voice. Speech-to-text and voices stay on the fleet. Message order: `src/codriver/talk.ts`. The "Hey Vela" wake word never calls it; it runs on the phone (ADR 0009). |

## Install and updates

Vela is an installable web app (`public/manifest.webmanifest`). The brand mark and every icon file come from one script, `tools/render-icons.sh` (a Nix shebang script; run it after changing the mark, and commit what it writes).

Nobody may get stuck on an old version. The pieces:

| Piece | Where | What it does |
|---|---|---|
| Build version | `vite.config.ts`, `flake.nix` | `VELA_VERSION` (the flake's short git revision, else `dev`) goes into the page and into `/sw.js`, so every release is a byte-different worker. Settings shows `Vela <version>`. |
| `AppStatus.checkForUpdate()` | `src/shell/app-status.ts` | Calls `registration.update()` and waits until a new worker takes over. Returns `"updated"`, `"current"` or `"failed"`; never rejects. |
| Automatic checks | `src/shell/app-status.ts` | Every 30 minutes, when the page becomes visible, and when the network comes back; at most one a minute. |
| `AppStatus.restart()` | `src/shell/app-status.ts` | Reloads whatever the update state. |
| The update chip | `src/ui/app/screen.ts` | "Update ready, tap to restart". Never during guidance: only with no route, or once arrived. |
| The version row | Settings | "Check for updates", "Checking for updates", "Up to date" (for 4 s), "Update ready, restart". A new version or a failed check reloads. |
| The boot-error escape | `src/sw/reset.ts` | "Try again" on "Vela can't start" unregisters the worker and deletes the `vela-shell-*` caches, then reloads. Offline audio, downloads, narration, the wake-word model and the Pyxis credentials stay. |

The host must serve `/`, `/sw.js`, `/config.json` and `/manifest.webmanifest` with `Cache-Control: no-store` (or `no-cache`), the icons (`/icons/*`, `/icon.svg`, `/favicon.*`, `/apple-touch-icon.png`) with `no-cache`, and `.webmanifest` as `application/manifest+json`. `/assets/*` are content-hashed and may be cached for a year. The service worker never caches the manifest or the icons.

## Done means

- `just verify` passes.
- Each engine has tests for its documented behaviour, including the offline and error paths.
- The reference UI shows every engine's state, ugly but complete.
