import { createRange } from "./range";
test("Range is fuel volume divided by time-integrated consumption over 15 minutes", () => {
  const range = createRange(50);
  expect(range.update({ at: 0, fuelPercent: 50, speedKmh: 100, fuelLitresHour: 10 })).toBeUndefined();
  expect(range.update({ at: 2000, fuelPercent: 50, speedKmh: 100, fuelLitresHour: 10 })).toBeCloseTo(250);
  for (let at = 4000; at <= 902000; at += 2000) range.update({ at, fuelPercent: 50, speedKmh: 50, fuelLitresHour: 10 });
  expect(range.update({ at: 904000, fuelPercent: 50, speedKmh: 50, fuelLitresHour: 10 })).toBeCloseTo(125);
});
test("no tank, no fuel, idling and stale samples produce no Range", () => {
  for (const tank of [undefined, 50]) {
    const range = createRange(tank); range.update({ at: 0, speedKmh: 100, fuelLitresHour: 10 });
    expect(range.update({ at: 2000, speedKmh: 100, fuelLitresHour: 10 })).toBeUndefined();
  }
  const range = createRange(50); range.update({ at: 0, fuelPercent: 50, speedKmh: 100, fuelLitresHour: 10 });
  expect(range.update({ at: 30000, fuelPercent: 50, speedKmh: 100, fuelLitresHour: 10 })).toBeUndefined();
});
