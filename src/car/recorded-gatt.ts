/** Notification replay at the real GATT seam. All replies are synthetic recorded ELM frames. */
import { type BluetoothAccess, type GattDevice, type GattCharacteristic, OBD_NOTIFY, OBD_WRITE, OBD_SERVICE } from "./gatt";
export class RecordedGattDevice implements GattDevice {
  readonly commands: string[] = [];
  readonly services: string[] = [];
  connected = false;
  connectionAttempts = 0;
  connectionError: Error | undefined;
  private readonly disconnected = new Set<() => void>();
  private readonly notifications = new Set<() => void>();
  private readonly rx: GattCharacteristic;
  readonly gatt: NonNullable<GattDevice["gatt"]>;
  constructor(readonly replies: Readonly<Record<string, readonly string[]>>, readonly chunks = 5) {
    this.rx = {
      startNotifications: async () => undefined, writeValueWithoutResponse: async () => { throw new Error("notify characteristic is not writable"); },
      addEventListener: (_, fn) => { this.notifications.add(fn); }, removeEventListener: (_, fn) => { this.notifications.delete(fn); },
    };
    const offsets = new Map<string, number>();
    const tx: GattCharacteristic = {
      startNotifications: async () => undefined, addEventListener() {}, removeEventListener() {},
      writeValueWithoutResponse: async (bytes) => {
        const command = new TextDecoder().decode(bytes).trim(); this.commands.push(command);
        const values = this.replies[command] ?? [command.startsWith("AT") ? "OK\r>" : "NO DATA\r>"];
        const index = offsets.get(command) ?? 0; offsets.set(command, index + 1);
        const reply = values[Math.min(index, values.length - 1)] ?? "NO DATA\r>";
        for (let i = 0; i < reply.length; i += this.chunks) {
          const data = new TextEncoder().encode(reply.slice(i, i + this.chunks));
          this.rx.value = new DataView(data.buffer);
          for (const fn of this.notifications) fn();
        }
      },
    };
    this.gatt = {
      connect: async () => {
        this.connectionAttempts++;
        if (this.connectionError) throw this.connectionError;
        this.connected = true;
        return { getPrimaryService: async (uuid) => {
          this.services.push(uuid); if (uuid !== OBD_SERVICE) throw new Error("unknown service");
          return { getCharacteristic: async (id) => {
            if (id === OBD_NOTIFY) return this.rx;
            if (id === OBD_WRITE) return tx;
            throw new Error("unknown characteristic");
          } };
        } };
      },
      disconnect: () => { if (!this.connected) return; this.connected = false; for (const fn of this.disconnected) fn(); },
    };
  }
  addEventListener(_: "gattserverdisconnected", fn: () => void) { this.disconnected.add(fn); }
  removeEventListener(_: "gattserverdisconnected", fn: () => void) { this.disconnected.delete(fn); }
  bluetooth(remembered = true): BluetoothAccess {
    return { getDevices: async () => remembered ? [this] : [], requestDevice: async () => this };
  }
}
