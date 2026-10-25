# The car app calls Pyxis and Ossicle directly, cross-origin

The car app runs on its own origin and calls both Services from the browser. Pyxis gains a CORS allowlist, and Ossicle's same-origin RPC check becomes an origin allowlist. We chose this over a small proxy server for the car app, because the driver did not want another service to install and run.

## Consequences

- Ossicle has no auth; its same-origin check is its only defence against cross-site requests. The allowlist must name the car app's exact origin, never `*`.
- Pyxis `/stream` needs a Bearer token, which an `<audio>` element cannot send. The car app's service worker must add the header, so Pyxis CORS must allow `Authorization` and `Range` and expose `Content-Range` and `Accept-Ranges`.
- Both Services change before the car app can work. Each change ships and deploys in its own repository.
