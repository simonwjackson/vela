import type { VelaConfig } from "../../contract";
import { createNavEngine } from "../../nav/engine";
import { ORIGIN, SwitchableNetwork, VALHALLA, ValhallaServer, buildLeg, traceAlong } from "../../nav/fixtures";
import { ManualFixSource } from "../../nav/position";
import { InMemoryStore } from "../../nav/storage";
import { formatArrival, formatDistance, formatDuration } from "./format";
import { mount } from "./mount";

const config: VelaConfig = {
  origins: {
    pyxis: "https://pyxis.test",
    ossicle: "https://ossicle.test",
    assistant: "https://assistant.test",
    voice: "https://voice.test",
    valhalla: VALHALLA,
    traccar: "https://traccar.test",
  },
  photonUrl: "https://photon.test",
  traccarDeviceId: "car-test",
  turnSoundLeadMs: 250,
};

const settle = () => new Promise((r) => setTimeout(r, 0));

test("formats long legs and short distances so they read at a glance", () => {
  expect(formatDistance(42)).toBe("40 m");
  expect(formatDistance(640)).toBe("640 m");
  expect(formatDistance(2_460)).toBe("2.5 km");
  expect(formatDistance(301_400)).toBe("301 km");
  expect(formatDuration(30)).toBe("under 1 min");
  expect(formatDuration(25 * 60)).toBe("25 min");
  expect(formatDuration(10_030)).toBe("2 h 47 min");
  const now = new Date(2026, 5, 1, 9, 0).getTime();
  expect(formatArrival(now + 3_600_000, now)).not.toMatch(/^[A-Z][a-z]{2} /);
  expect(formatArrival(now + 30 * 3_600_000, now)).toMatch(/^[A-Z][a-z]{2} /);
});

test("search, choose a place, see guidance, go offline, end the route", async () => {
  const leg = buildLeg(
    ORIGIN,
    [
      { headingDeg: 0, meters: 1000, street: "Alpha Road", speedMps: 15, type: 1 },
      { headingDeg: 90, meters: 500, street: "Beta Street", speedMps: 15, type: 10 },
    ],
    "Invented Cafe",
  );
  const valhalla = new ValhallaServer(() => [leg]);
  const photon: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        features: [
          { geometry: { coordinates: [leg.end.lng, leg.end.lat] }, properties: { name: "Invented Cafe", city: "Nowhere" } },
        ],
      }),
    );
  const fetcher: typeof fetch = (input, init) =>
    String(input).startsWith("https://photon.test") ? photon(input, init) : valhalla.fetch(input, init);
  const fixes = new ManualFixSource();
  const network = new SwitchableNetwork();
  const nav = createNavEngine({ config, fixes, store: new InMemoryStore(), network, fetcher });
  let tripsListener: ((s: { moving: boolean; queued: number }) => void) | undefined;
  const root = document.createElement("div");
  document.body.append(root);
  const unmount = mount(root, {
    nav,
    trips: {
      subscribe: (l) => {
        tripsListener = l;
        return () => {};
      },
    },
  });
  fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5, speedMps: 0 });
  const part = (name: string) => root.querySelector(`[data-part="${name}"]`) as HTMLElement;

  expect(part("guidance").textContent).toContain("No route");
  expect(part("readouts").textContent).toContain("limit unknown");
  tripsListener?.({ moving: true, queued: 3 });
  expect(part("trips").textContent).toBe("Trips: moving, 3 waiting to send");

  const input = root.querySelector("input") as HTMLInputElement;
  input.value = "cafe";
  root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  const result = part("results").querySelector('[data-action="go"]') as HTMLButtonElement;
  expect(result.textContent).toBe("Invented Cafe, Nowhere");
  result.click();
  await settle();
  await settle();

  for (const fix of traceAlong(leg.points, { speedMps: 20, startAt: Date.now(), toMeters: 400 })) fixes.push(fix);
  const text = part("guidance").textContent ?? "";
  expect(part("guidance").dataset.state).toBe("guiding");
  expect(text).toContain("Turn right onto Beta Street");
  expect(text).toContain("in 600 m");
  expect(text).toContain("then Arrive at Invented Cafe");
  expect(text).toContain("1.1 km left");
  expect(part("readouts").textContent).toContain("72 km/h");
  expect(part("recent").textContent).toContain("Invented Cafe");

  network.set(false);
  expect(part("guidance").textContent).toContain("No signal: guiding from the saved route.");

  (part("guidance").querySelector('[data-action="end"]') as HTMLButtonElement).click();
  expect(part("guidance").dataset.state).toBe("idle");

  unmount();
  expect(root.childElementCount).toBe(0);
  nav.dispose();
});
