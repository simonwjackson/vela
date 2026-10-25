# Vela

A calm car dashboard for one phone in a car mount. Vela answers the driving questions at a glance (what is the next turn, how far is it, how much longer is left) without drawing a street map. It also plays music, podcasts and books from services you run yourself.

Status: early. The engines are being built. The visual design is not decided, so the current interface is a deliberately plain reference client.

## Develop

```sh
nix develop
npm install
just verify   # typecheck, lint, tests
just dev
```

The app reads `/config.json` at startup. It holds the origins of the services you run. See `src/contract/config.ts`.

## Read next

- `CONTEXT.md`: the words this project uses.
- `docs/adr/`: decisions and why they were made.
- `docs/contract.md`: module ownership and how the pieces meet.
