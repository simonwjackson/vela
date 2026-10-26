import { CO_DRIVER_FALLBACK_NAME, coDriverInfo, coDriverName } from "./names";
import { base64ToPcm16, micToGateway, pcm16ToBase64, pcm16ToFloat } from "./pcm";

test("16 kHz frames become 24 kHz PCM16 and survive base64 both ways", () => {
  const ramp = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 10) * 0.5);
  const pcm = micToGateway(ramp);
  expect(pcm).toHaveLength(2400);
  expect(pcm[0]).toBe(0);
  expect(pcm[3]).toBe(Math.round(ramp[2] as number * 32767));
  const back = base64ToPcm16(pcm16ToBase64(pcm));
  expect([...back]).toEqual([...pcm]);
  expect(base64ToPcm16(pcm16ToBase64(Int16Array.of(-32768, 32767, -1)))).toEqual(Int16Array.of(-32768, 32767, -1));
  expect(pcm16ToFloat(Int16Array.of(-32768))[0]).toBe(-1);
});

test("display names: the three defaults capitalised, otherwise 'Your co-driver'", () => {
  expect(coDriverName(coDriverInfo("companion"))).toBe("Companion");
  expect(coDriverInfo("navigator").kind).toBe("navigator");
  expect(coDriverName(coDriverInfo("night-owl"))).toBe(CO_DRIVER_FALLBACK_NAME);
  expect(CO_DRIVER_FALLBACK_NAME).toBe("Your co-driver");
});
