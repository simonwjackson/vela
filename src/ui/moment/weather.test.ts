import type { WeatherStretch } from "../../contract";
import { mount } from "../app/mount";
import { fakes } from "../dev/fakes";
import { dataOf, momentScene, setUp } from "../dev/moments";
import { figureOf, nameOf, sequenceOf } from "./data";
import { checkProgram } from "./gate";
import { read } from "./program";
import { drawTree } from "./render";

const forecast: readonly WeatherStretch[] = [
  { fromKm: 0, toKm: 10, kind: "clear", label: "Clear", current: true },
  { fromKm: 10, toKm: 30, kind: "rain", label: "Rain", current: false },
  { fromKm: 30, toKm: 60, kind: "clear", label: "Clear", current: false },
];
const program = 'root = Screen([Lead(Hero("nav.next")), Sequence("weather.stretches"), TripRow()])';
function setup() {
  const f = fakes(); const scene = momentScene("fuel");
  if (!scene) throw new Error("Missing scene");
  const initial = setUp(scene, f, false); f.weather.set(forecast);
  return { f, scene, initial, data: dataOf(f, initial) };
}
afterEach(() => document.body.replaceChildren());
test("weather names, distance and spike rain values bind to the forecast, not model text", () => {
  const { data, f } = setup();
  expect(nameOf("weather.now", data)).toBe("Clear"); expect(nameOf("weather.next", data)).toBe("Rain");
  expect(figureOf("weather.change.in", data)).toEqual({ num: "10", unit: "km" });
  expect(figureOf("weather.rain.in", data)).toEqual({ num: "10", unit: "km" });
  expect(figureOf("weather.rain.length", data)).toEqual({ num: "20", unit: "km" });
  expect(figureOf("weather.rain.at", data)).toBeDefined();
  f.weather.set([]);
  expect(nameOf("weather.next", data)).toBeUndefined(); expect(figureOf("weather.change.in", data)).toBeUndefined();
  expect(sequenceOf("weather.stretches", data)).toBeUndefined();
});
test("the weather sequence retains interval endpoints and current/marked flags for UI styling", () => {
  const { data } = setup(); const sequence = sequenceOf("weather.stretches", data);
  expect(sequence).toEqual([
    { label: "Clear", sub: "now", at: 0, to: 1 / 6, current: true, marked: false },
    { label: "Rain", sub: "in 10 km", at: 1 / 6, to: 0.5, current: false, marked: true },
    { label: "Clear", sub: "in 30 km", at: 0.5, to: 1, current: false, marked: false },
  ]);
  expect(sequenceOf("route.weather", data)).toEqual(sequence);
  const root = read(program).root; if (!root) throw new Error("Missing root");
  const drawn = drawTree(root, data, { keyboard: 0 }); const element = document.createElement("div"); element.append(...drawn.els);
  expect(element.querySelector('.m-seq[aria-label="Weather ahead"]')).not.toBeNull();
  expect([...element.querySelectorAll(".m-seq-item b")].map((el) => el.textContent)).toEqual(["Clear", "Rain", "Clear"]);
});
test("the gate accepts known weather and refuses missing forecast data", () => {
  const { f, data } = setup(); const show = { say: "I will watch the conditions.", when: "now" as const };
  expect(checkProgram({ program, show, data })).toEqual([]);
  f.weather.set([]); expect(checkProgram({ program, show, data }).map((p) => p.code)).toContain("no-data");
});
test("a mounted weather Moment redraws when its forecast provider changes", async () => {
  const { f, data } = setup(); const root = document.createElement("div"); document.body.append(root);
  const unmount = mount(root, f, { now: () => data.input.now });
  try {
    f.moments.show({ type: "moment.show", id: "weather-moment", program, say: "I will watch the conditions.", when: "now", until: { seconds: 60 }, cause: { event: "weather-change" }, silent: true });
    for (let i = 0; i < 200 && !root.querySelector(".m-seq"); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(f.moments.sent[0]).toEqual(["problems", "weather-moment", []]);
    expect(root.querySelector(".m-seq")?.textContent).toContain("in 10 km");
    f.weather.set(forecast.map((s) => ({ ...s, fromKm: Math.max(0, s.fromKm - 2), toKm: s.toKm - 2 })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(root.querySelector(".m-seq")?.textContent).toContain("in 8.0 km");
  } finally { unmount(); }
});
