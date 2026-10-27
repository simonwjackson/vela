import type { BluetoothAccess } from "./gatt";
import { createCarLink } from "./link";
import { RecordedGattDevice } from "./recorded-gatt";
afterEach(() => vi.useRealTimers());
const replies = { "0140": ["414000000004\r>"], "012F": ["412F80\r>"] };

test("disconnect retries the remembered device, backs off failures, then exposes the tap state", async () => {
  vi.useFakeTimers(); const device = new RecordedGattDevice(replies);
  let remembered = true; let lookups = 0; let pickerCalls = 0;
  const bluetooth: BluetoothAccess = {
    getDevices: async () => { lookups++; return remembered ? [device] : []; },
    requestDevice: async () => { pickerCalls++; return device; },
  };
  const car = createCarLink({ bluetooth });
  try {
    await car.start(); expect(car.state.kind).toBe("connected");
    device.gatt.disconnect(); expect(car.state.kind).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1999); expect(lookups).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(car.state.kind).toBe("connected"); expect(lookups).toBe(2);
    device.connectionError = new Error("adapter out of range");
    device.gatt.disconnect(); await vi.advanceTimersByTimeAsync(2000); expect(car.state.kind).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(4999); expect(lookups).toBe(3);
    device.connectionError = undefined; await vi.advanceTimersByTimeAsync(1); expect(car.state.kind).toBe("connected");
    remembered = false; device.gatt.disconnect(); await vi.advanceTimersByTimeAsync(2000);
    expect(car.state).toEqual({ kind: "connect", reason: "no-device" }); expect(pickerCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(120000); expect(lookups).toBe(5);
    await car.connect(); expect(pickerCalls).toBe(1); expect(car.state.kind).toBe("connected");
  } finally { car.dispose(); }
});

test("an unavailable or denied remembered-device API needs a user tap, not repeated pickers", async () => {
  vi.useFakeTimers(); const device = new RecordedGattDevice(replies);
  for (const lookup of [undefined, async () => { throw new DOMException("gesture required", "NotAllowedError"); }, async () => []]) {
    const bluetooth: BluetoothAccess = { requestDevice: async () => device, ...(lookup ? { getDevices: lookup } : {}) };
    const car = createCarLink({ bluetooth });
    try { await car.start(); expect(car.state.kind).toBe("connect"); await vi.advanceTimersByTimeAsync(120000); expect(device.connected).toBe(false); }
    finally { car.dispose(); }
  }
});


test("automatic retries pause while hidden, resume when visible and stop on disposal", async () => {
  vi.useFakeTimers(); const device = new RecordedGattDevice(replies);
  const page = Object.assign(new EventTarget(), { hidden: false });
  const car = createCarLink({ bluetooth: device.bluetooth(), page });
  try {
    await car.start(); device.gatt.disconnect();
    page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
    expect(car.state).toMatchObject({ kind: "reconnecting", attempt: 1 }); expect("retryAt" in car.state).toBe(false);
    await vi.advanceTimersByTimeAsync(120000); expect(device.connectionAttempts).toBe(1);
    page.hidden = false; page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(2000); expect(device.connectionAttempts).toBe(2); expect(car.state.kind).toBe("connected");
    device.gatt.disconnect(); car.dispose(); await vi.advanceTimersByTimeAsync(120000); expect(device.connectionAttempts).toBe(2);
  } finally { car.dispose(); }
});

test("repeated transient failures cap retry delays at sixty seconds", async () => {
  vi.useFakeTimers(); const device = new RecordedGattDevice(replies);
  const car = createCarLink({ bluetooth: device.bluetooth() });
  try {
    await car.start(); device.connectionError = new Error("adapter out of range"); device.gatt.disconnect();
    let attempts = 1;
    for (const delay of [2000, 5000, 15000, 30000, 60000, 60000]) {
      expect(car.state).toMatchObject({ kind: "reconnecting", retryAt: Date.now() + delay });
      await vi.advanceTimersByTimeAsync(delay - 1); expect(device.connectionAttempts).toBe(attempts);
      await vi.advanceTimersByTimeAsync(1); expect(device.connectionAttempts).toBe(++attempts);
    }
  } finally { car.dispose(); }
});

test("GATT permission recovery requires a tap instead of automatic retries", async () => {
  vi.useFakeTimers(); const device = new RecordedGattDevice(replies);
  const car = createCarLink({ bluetooth: device.bluetooth() });
  try {
    await car.start(); device.connectionError = new DOMException("gesture required", "NotAllowedError"); device.gatt.disconnect();
    await vi.advanceTimersByTimeAsync(2000); expect(car.state).toEqual({ kind: "connect", reason: "permission" });
    const attempts = device.connectionAttempts; await vi.advanceTimersByTimeAsync(120000); expect(device.connectionAttempts).toBe(attempts);
  } finally { car.dispose(); }
});

test("successful init followed by PID timeouts keeps increasing the reconnect backoff", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const device = new RecordedGattDevice({ ...replies, "0146": ["", "", "", "41463C\r>"] });
  const attemptsAt: number[] = [];
  const bluetooth: BluetoothAccess = {
    getDevices: async () => { attemptsAt.push(Date.now()); return [device]; },
    requestDevice: async () => device,
  };
  const car = createCarLink({ bluetooth });
  try {
    const starting = car.start();
    await vi.advanceTimersByTimeAsync(8000); await starting;
    expect(car.state).toMatchObject({ kind: "reconnecting", attempt: 1, retryAt: 10000 });
    await vi.advanceTimersByTimeAsync(2000 + 8000);
    expect(car.state).toMatchObject({ kind: "reconnecting", attempt: 2, retryAt: 23000 });
    await vi.advanceTimersByTimeAsync(5000 + 8000);
    expect(car.state).toMatchObject({ kind: "reconnecting", attempt: 3, retryAt: 46000 });
    await vi.advanceTimersByTimeAsync(15000);
    expect(attemptsAt).toEqual([0, 10000, 23000, 46000]);
    expect(car.state.kind).toBe("connected"); expect(car.readings.ambientC).toBe(20);
    // Only this complete poll cycle earns a fresh two-second retry delay.
    device.gatt.disconnect();
    expect(car.state).toMatchObject({ kind: "reconnecting", attempt: 1, retryAt: 48000 });
  } finally { car.dispose(); }
});
