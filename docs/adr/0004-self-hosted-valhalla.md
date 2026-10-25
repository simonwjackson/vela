# Routes come from a self-hosted Valhalla on the tailnet

Vela asks a Valhalla server on one of the driver's own machines for routes, over Tailscale. We chose this over public OpenStreetMap routing servers (fair-use, may block or vanish) and commercial free tiers (accounts, keys, limits), because the driver wants it free, private and unthrottled.

## Consequences

- ETAs have no live traffic data.
- Someone maintains the server: the map extract needs periodic rebuilds, and the host needs enough RAM and disk to build the graph.
- The phone must be on the tailnet to start a route. Once a route has started, ADR 0002 keeps guidance working without signal.
