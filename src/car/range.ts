import type { CarReadings } from "../contract";
const WINDOW_MS = 15 * 60 * 1000;
/** Integrate fuel and distance over the same time window, including idling fuel. */
export function createRange(tankLitres?: number) {
  let previous: CarReadings | undefined;
  let segments: { from: number; to: number; km: number; litres: number }[] = [];
  return {
    reset() { previous = undefined; segments = []; },
    update(reading: CarReadings): number | undefined {
      const last = previous; previous = reading;
      const rate = last?.fuelLitresHour ?? (last?.mafGramsSec === undefined ? undefined : last.mafGramsSec * 3600 / (14.7 * 745));
      if (last && rate !== undefined && last.speedKmh !== undefined && reading.at > last.at && reading.at - last.at <= 10000) {
        const hours = (reading.at - last.at) / 3600000;
        segments.push({ from: last.at, to: reading.at, km: last.speedKmh * hours, litres: rate * hours });
      }
      const cutoff = reading.at - WINDOW_MS;
      segments = segments.filter((s) => s.to > cutoff);
      let km = 0; let litres = 0;
      for (const s of segments) { const fraction = (s.to - Math.max(s.from, cutoff)) / (s.to - s.from); km += s.km * fraction; litres += s.litres * fraction; }
      if (!tankLitres || tankLitres <= 0 || reading.fuelPercent === undefined || litres <= 0 || km <= 0) return undefined;
      return reading.fuelPercent / 100 * tankLitres * km / litres;
    },
  };
}
