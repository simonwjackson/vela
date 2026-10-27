# Listening

| Path | What it holds |
|---|---|
| `src/audio/listening.ts` | The `Listening` engine: one Now playing, the Shelf, speech/Talk holds, periodic position sync |
| `src/audio/media-session.ts` | Media Session binding: metadata, play/pause, seekto, stereo previous/next |
| `src/audio/vela-listening.ts` | Browser composition root: `createVelaListening(config)` |
| `src/sources/pyxis-*.ts` | Music: device claim, session hosting over `/realtime`, outbox, listens |
| `src/sources/ossicle-*.ts` | Podcasts (`/rpc`, `/audio`) and Books (`/comics/rpc`, narration) |
| `src/sources/position-conflict.ts` | The position Conflict rule, with the Service rules it relies on |
| `src/sw/` | Service worker (Bearer injection for `/stream`, offline copies with Range), download rules and runner |
| `src/ui/app/mount.ts` | The Signal UI (design's), which shows Listening among the rest |

## Wiring in the shell

`src/shell/compose.ts` builds Listening with the other engines, and `src/main.ts` registers the
service worker and mounts the UI:

```ts
await registerListeningWorker("/sw.js");
const vela = createVelaListening(config); // inside composeVela(config)
// Turn sounds play over media without a Listening yield.
// Co-driver speech uses listening.holdForTalk(); Talk uses holdForTalk("listening") for the full turn.
mount(root, vela.deps, { version, testTurnSound });
```

The build must emit `src/sw/service-worker.ts` as `/sw.js` at the site root, so its scope covers the
page. Without the worker, Music cannot stream (the media element cannot send the Bearer token) and
nothing plays offline.

## Rules worth knowing

- Position Conflicts: theirs (the newest) wins unless the car is ahead; then the car forces its
  position against their revision. See `src/sources/position-conflict.ts`.
- Sounds-only Turn sounds overlay media unchanged. The sine-tone peak is 0.98 (up from 0.35, +8.94 dB), so individual tones stay below full scale without compressor pumping.
- Co-driver speech (`holdForTalk()`): Music ducks to 25 % and restores; Podcasts and Books pause and resume 2 s back.
- Talk (`holdForTalk("listening")`): all Sources pause from press or wake through the final answer sample, cancel or no-answer timeout. Holds nest with speech; only the last release resumes the held item. Music resumes in place. A driver transport command cancels automatic resume.
- `volume` commands set absolute local-device volume (0–100) on the active Source, separate from the Service volume, through pause/resume and duck/restore. This override lasts until reload; it does not change a remote Pyxis session volume.
- Talk connects with the stable, random `vela.installId` channel and `surface=talk`. `assistant.action` media requests are validated and deduplicated across reconnects; `skip` uses Listening forward (next Music track, 30 s in Podcasts/Books), and `podcast` searches Podcasts and plays the first result. Optional `CoDriver.onCard` carries validated Weather/Reflex cards without speaking them. Enrichment is ignored.
- Downloads run on Wi-Fi only (`navigator.connection.type`), otherwise only with the manual switch.
  Selection rules are in `src/sw/download-plan.ts`.
- Storage on the device: the Shelf, positions, the Pyxis outbox and listens in `localStorage`; the
  Pyxis device token in Cache Storage (the service worker must read it); audio and prepared
  narration in Cache Storage.
