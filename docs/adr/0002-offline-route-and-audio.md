# Routes and audio survive dead zones; re-routing does not

At route start the app fetches the whole route and every instruction, so guidance continues without signal; it cannot re-route until signal returns. Full offline maps and on-phone routing were rejected as too large for a PWA. Audio also plays offline: on Wi-Fi the app downloads upcoming Podcasts, the current Book and pinned Music into its own storage.

## Consequences

- Browser storage belongs to one origin, so the car app keeps its own copies. Audio already downloaded by the Pyxis or Ossicle apps is stored twice on the phone.
- Books narration is generated on demand by Ossicle, so offline Books means asking Ossicle to prepare narration ahead and downloading it.
