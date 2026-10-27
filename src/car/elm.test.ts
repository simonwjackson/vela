import { decodeDtcs, decodePid, readCommand, supportsFuelRate, OBD_READS, ELM_INIT, pollPlan } from "./elm";
import { connectElm, OBD_SERVICE } from "./gatt";
import { createCarLink } from "./link";
import { RecordedGattDevice } from "./recorded-gatt";

const replies = {
  "0140": ["41 40 00 00 00 04\r>"], "012F": ["41 2F 80\r>"],
  "0146": ["41 46 3C\r>"], "0105": ["41 05 82\r>"], "0142": ["41 42 36 B0\r>"],
  "010D": ["41 0D 64\r>"], "015E": ["41 5E 00 C8\r>"], "0101": ["41 01 81 00 00 00\r>"],
  "03": ["43 01 33 00 00 00 00\r>"],
};
afterEach(() => vi.useRealTimers());
test("decodes standard OBD-II PIDs, MIL and stored codes without inventing missing data", () => {
  expect(decodePid("2F", "41 2F 80\r>").fuelPercent).toBeCloseTo(50.196);
  expect(decodePid("46", "41463C")).toEqual({ ambientC: 20 });
  expect(decodePid("05", "410582")).toEqual({ coolantC: 90 });
  expect(decodePid("42", "414236B0")).toEqual({ voltage: 14 });
  expect(decodePid("0D", "410D64")).toEqual({ speedKmh: 100 });
  expect(decodePid("10", "411003E8")).toEqual({ mafGramsSec: 10 });
  expect(decodePid("5E", "415E00C8")).toEqual({ fuelLitresHour: 10 });
  expect(decodePid("01", "410181000000")).toEqual({ mil: true });
  expect(decodePid("42", "NO DATA")).toEqual({}); expect(decodePid("42", "414236")).toEqual({});
  expect(decodeDtcs("43 01 33 C1 00 00 00")).toEqual(["P0133", "U0100"]);
  expect(supportsFuelRate("414000000004")).toBe(true);
  expect(supportsFuelRate("NO DATA")).toBe(false);
  for (const command of ["04", "ATSH7E0", "0902", "012F;04"]) expect(() => readCommand(command)).toThrow("read-only");
});
test("actual GATT protocol reassembles fragmented notifications and enforces read-only writes", async () => {
  const device = new RecordedGattDevice(replies, 1); const elm = await connectElm(device);
  expect(await elm.command("012F")).toContain("41 2F 80");
  expect(device.services).toEqual([OBD_SERVICE]); await expect(elm.command("04")).rejects.toThrow("read-only"); elm.close();
});
test("remembered adapter initializes, polls, computes Range and falls back after disconnect", async () => {
  vi.useFakeTimers(); const device = new RecordedGattDevice(replies);
  const car = createCarLink({ bluetooth: device.bluetooth(), tankLitres: 50 }); await car.start();
  expect(car.state.kind).toBe("connected"); expect(car.readings.mil).toBe(true); expect(car.readings.dtcs).toEqual(["P0133"]);
  expect(device.commands.slice(0, 7)).toEqual(["ATZ", "ATE0", "ATL0", "ATS1", "ATH0", "ATSP0", "0140"]);
  await vi.advanceTimersByTimeAsync(2000); expect(car.readings.rangeKm).toBeCloseTo(250.98);
  expect(device.commands.filter((c) => c === "012F")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(28000); expect(device.commands.filter((c) => c === "012F")).toHaveLength(2);
  device.gatt.disconnect(); expect(car.state.kind).toBe("reconnecting"); expect(car.readings.rangeKm).toBeUndefined(); car.dispose();
});
test("manual permission path, absent Bluetooth, and MAF fallback", async () => {
  vi.useFakeTimers(); const device = new RecordedGattDevice({ ...replies, "0140": ["NO DATA\r>"], "0110": ["411003E8\r>"] });
  const car = createCarLink({ bluetooth: device.bluetooth(false) }); await car.start(); expect(car.state.kind).toBe("connect");
  await car.connect(); expect(device.commands).toContain("0110"); expect(device.commands).not.toContain("015E"); expect(car.readings.rangeKm).toBeUndefined(); car.dispose();
  const unavailable = createCarLink({}); await unavailable.start(); expect(unavailable.state.kind).toBe("unavailable"); unavailable.dispose();
});

test("a missing ELM prompt times out and cannot desynchronize another command", async () => {
  vi.useFakeTimers(); const device = new RecordedGattDevice({ "012F": [""] }); const elm = await connectElm(device);
  const timedOut = expect(elm.command("012F")).rejects.toThrow("timeout");
  await vi.advanceTimersByTimeAsync(8000); await timedOut;
  await expect(elm.command("010D")).rejects.toThrow("closed"); elm.close();
});


test("the safety allowlist and poll plan come only from the descriptor catalog", () => {
  const permitted = new Set<string>([...ELM_INIT, ...OBD_READS.map((read) => read.command)]);
  for (const command of permitted) expect(readCommand(command)).toBe(`${command}\r`);
  for (let mode = 0; mode <= 255; mode++) {
    for (let pid = 0; pid <= 255; pid++) {
      const command = mode.toString(16).toUpperCase().padStart(2, "0") + pid.toString(16).toUpperCase().padStart(2, "0");
      if (!permitted.has(command)) expect(() => readCommand(command)).toThrow("read-only");
    }
  }
  expect(() => readCommand("04")).toThrow("read-only");
  const all = pollPlan(true, 0, new Map()); const maf = pollPlan(false, 0, new Map());
  expect(all.find((read) => read.choice)?.choice).toBe("fuel-rate"); expect(maf.find((read) => read.choice)?.choice).toBe("maf");
  for (const read of all) expect(OBD_READS).toContain(read);
  const seen = new Map(all.map((read) => [read.command, 0]));
  expect(pollPlan(true, 1999, seen)).toEqual([]);
  expect(pollPlan(true, 2000, seen).every((read) => read.cadenceMs === 2000)).toBe(true);
  expect(pollPlan(true, 30000, seen).some((read) => read.cadenceMs === 30000)).toBe(true);
});
