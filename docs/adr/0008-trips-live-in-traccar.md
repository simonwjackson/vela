# Trips are recorded in a self-hosted Traccar

Vela reports the car's position to a self-hosted Traccar while you drive. Traccar's Trips report (start and end address, times, distance, duration) is what the personal assistant reads to recall past drives. We chose Traccar over Reitti and Dawarich because only drives are remembered, not all-day location, and Traccar is built for vehicle trips. Logbook was rejected: its scope is health data, and it has no places or coordinates.

Traccar runs on the storage server, next to Valhalla. Vela records every drive while it is open and the car is moving, with or without a Route. Trips and their GPS points are kept forever.

## Consequences

- One more service on the fleet (Java).
- The personal assistant needs a Traccar skill, as it has for logbook.
- Positions recorded in dead zones are queued on the phone and sent with their original timestamps when signal returns.
