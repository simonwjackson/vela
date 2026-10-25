# Vela is installed and configured by the mountainous flake

Vela and its routing server are installed through the mountainous fleet flake, which also holds their personal configuration. Pyxis and Ossicle instead use a user `nix profile` with config files in `~/.config`. We chose the flake so that Vela's personal values live in one declared place next to the rest of the fleet. Vela's own repository stays public and generic (ADR 0005).

## Consequences

- Vela's repository exports a package and a module with options for every deploy-time value. The flake sets those options.
- Deploying a Vela change means updating the flake input and switching the host, not `nix profile upgrade`.
