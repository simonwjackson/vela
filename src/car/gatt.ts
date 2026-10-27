import { readCommand } from "./elm";
export const OBD_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
export const OBD_NOTIFY = "0000fff1-0000-1000-8000-00805f9b34fb";
export const OBD_WRITE = "0000fff2-0000-1000-8000-00805f9b34fb";
export interface GattCharacteristic {
  value?: DataView;
  startNotifications(): Promise<unknown>;
  writeValueWithoutResponse(value: Uint8Array): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", fn: () => void): void;
  removeEventListener(type: "characteristicvaluechanged", fn: () => void): void;
}
export interface GattDevice {
  gatt?: { connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<GattCharacteristic> }> }>; disconnect(): void };
  addEventListener(type: "gattserverdisconnected", fn: () => void): void;
  removeEventListener(type: "gattserverdisconnected", fn: () => void): void;
}
export interface BluetoothAccess {
  getDevices?(): Promise<GattDevice[]>;
  requestDevice(options: { filters: { services: string[] }[] }): Promise<GattDevice>;
}
export function browserBluetooth(): BluetoothAccess | undefined {
  return (navigator as Navigator & { bluetooth?: BluetoothAccess }).bluetooth;
}
export interface ElmConnection { command(command: string): Promise<string>; close(): void }
/** Prompt-delimited, serialized ELM exchange. No command pipelining. */
export async function connectElm(device: GattDevice): Promise<ElmConnection> {
  if (!device.gatt) throw new Error("No GATT server");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(OBD_SERVICE);
  const rx = await service.getCharacteristic(OBD_NOTIFY); const tx = await service.getCharacteristic(OBD_WRITE);
  let pending: { resolve: (text: string) => void; reject: (error: Error) => void } | undefined;
  let text = ""; let closed = false;
  const decoder = new TextDecoder();
  const receive = () => {
    if (!rx.value || !pending) return;
    text += decoder.decode(rx.value);
    if (text.includes(">")) { const done = pending; pending = undefined; done.resolve(text.slice(0, text.indexOf(">"))); text = ""; }
  };
  rx.addEventListener("characteristicvaluechanged", receive);
  try { await rx.startNotifications(); }
  catch (error) { rx.removeEventListener("characteristicvaluechanged", receive); device.gatt.disconnect(); throw error; }
  return {
    async command(command) {
      const encoded = new TextEncoder().encode(readCommand(command));
      if (closed || pending) throw new Error("ELM connection closed or busy");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<string>((resolve, reject) => {
          text = ""; pending = { resolve, reject };
          timer = setTimeout(() => { pending = undefined; closed = true; reject(new Error("ELM reply timeout")); }, 8000);
          void tx.writeValueWithoutResponse(encoded).catch((error: unknown) => { pending = undefined; reject(error); });
        });
      } finally { clearTimeout(timer); }
    },
    close() {
      closed = true; pending?.reject(new Error("ELM disconnected")); pending = undefined;
      rx.removeEventListener("characteristicvaluechanged", receive); device.gatt?.disconnect();
    },
  };
}
