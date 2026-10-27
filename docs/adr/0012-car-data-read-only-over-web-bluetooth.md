# Car data is read from an OBD adapter over Web Bluetooth, read-only

Vela reads the car's live data (fuel level, outside temperature, coolant, voltage, speed, fault codes and the check-engine light) from a Bluetooth Low Energy OBD-II adapter, straight from the page with Web Bluetooth. A native helper app was rejected: the BLE adapter's serial service is open to Chrome on Android, so no second program is needed. Vela never writes to the car: clearing fault codes hides problems and resets the emissions monitors, so that stays with a garage or a scan app.

The car reports no Range, so Vela estimates it from fuel level, tank size and recent consumption.

## Consequences

- Vela reconnects to the known adapter on its own when Chrome allows it, and otherwise shows a one-tap "Connect car" chip once per drive. Without the adapter, Moments simply have no car data.
- Car readings travel with each Trip position to Traccar (ADR 0008), so the personal assistant can recall them. Traccar's database still has no backup.
- The tank size is a setting, not a constant, because it differs by car.
