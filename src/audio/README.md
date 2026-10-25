# Listening

| Path | What it holds |
|---|---|
| `src/audio/listening.ts` | The `Listening` engine: one Now playing, the Shelf, Turn sound yields, periodic position sync |
| `src/audio/media-session.ts` | Media Session binding: metadata, play/pause, seekto, stereo previous/next |
| `src/audio/vela-listening.ts` | Browser composition root: `createVelaListening(config)` |
| `src/sources/pyxis-*.ts` | Music: device claim, session hosting over `/realtime`, outbox, listens |
| `src/sources/ossicle-*.ts` | Podcasts (`/rpc`, `/audio`) and Books (`/comics/rpc`, narration) |
| `src/sources/position-conflict.ts` | The position Conflict rule, with the Service rules it relies on |
| `src/sw/` | Service worker (Bearer injection for `/stream`, offline copies with Range), download rules and runner |
| `src/ui/listen/mount.ts` | Plain reference UI |

## Wiring in the shell

```ts
import { createVelaListening } from "./audio/vela-listening";
import { registerListeningWorker } from "./sw/register";
import { mount } from "./ui/listen/mount";

await registerListeningWorker("/sw.js");
const vela = createVelaListening(config);
mount(root, { listening: vela.listening, downloads: vela.downloads });
// Navigation calls vela.listening.yieldForTurnSound(durationMs) around every Turn sound.
```

The build must emit `src/sw/service-worker.ts` as `/sw.js` at the site root, so its scope covers the
page. Without the worker, Music cannot stream (the media element cannot send the Bearer token) and
nothing plays offline.

## Rules worth knowing

- Position Conflicts: theirs (the newest) wins unless the car is ahead; then the car forces its
  position against their revision. See `src/sources/position-conflict.ts`.
- Turn sounds: Music ducks to 25 % and restores; Podcasts and Books pause and resume 2 s back.
  A driver command during the sound cancels the automatic resume.
- Downloads run on Wi-Fi only (`navigator.connection.type`), otherwise only with the manual switch.
  Selection rules are in `src/sw/download-plan.ts`.
- Storage on the device: the Shelf, positions, the Pyxis outbox and listens in `localStorage`; the
  Pyxis device token in Cache Storage (the service worker must read it); audio and prepared
  narration in Cache Storage.
