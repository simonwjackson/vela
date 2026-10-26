/**
 * The scenes the spike renders: the five approved states (the dev page's own fakes) and the four
 * novel contexts the co-driver composes for. Fictional data only, like dev/fixtures.ts.
 */
import { NOW, fixtures, guidance, item, playing } from "../dev/fixtures";
import { scenario } from "../dev/scenarios";
import { type Scene, fromScenario } from "./live";

const at = (h: number, m: number): number => new Date(2026, 9, 26, h, m).getTime();
const place = (name: string, address?: string) => ({ name, ...(address ? { address } : {}), lat: 0.21, lng: -0.31 });

/** Run a dev scenario's setup on the fakes, then change what the scene needs. */
function on(id: string, f: Parameters<Scene["build"]>[0], stress: boolean) {
  const sc = scenario(id);
  if (!sc) throw new Error(`No dev scenario ${id}`);
  return sc.setup(f, fixtures(stress), stress) ?? {};
}

export const SCENES: readonly Scene[] = [
  { id: "near", label: "Turn ahead", situation: "Guiding: the next turn is 400 m ahead. Music plays.", build: fromScenario("near") },
  { id: "far", label: "Long leg", situation: "Guiding on a long leg: the next turn is 64 km ahead. A podcast plays.", build: fromScenario("far") },
  { id: "noroute", label: "No route", situation: "No route. Music plays.", build: fromScenario("noroute") },
  { id: "speaking", label: "Co-driver answers", situation: "Guiding. The co-driver is answering the driver.", build: fromScenario("speaking") },
  { id: "stops", label: "Route", situation: "Guiding, with a stop on the way. The driver opened the route.", build: fromScenario("stops") },
  {
    id: "rain",
    label: "(a) Rain on a long leg",
    situation: "Rain is starting. 140 km are left on a long leg of the trip, and an audiobook is playing.",
    build: (f, stress) => {
      const x = fixtures(stress);
      const setup = on("far", f, stress);
      const r = { ...x.long.route, km: 465, leftMin: 95, arriveAt: at(15, 0), progress: 0.7 };
      f.nav.state = { kind: "guiding", guidance: guidance(r, { metersLeft: 140_000, progress: 0.7 }) };
      f.listening.nowPlaying = x.book;
      return { setup, extras: { weather: { now: stress ? "Heavy rain and spray on Route 9 toward Port Ellery" : "Light rain", next: "Heavier from 2:05 PM" } } };
    },
  },
  {
    id: "episode",
    label: "(b) Episode ends before arrival",
    situation: "A podcast episode ends 4 minutes before arrival. The co-driver recommends the next episode.",
    build: (f, stress) => {
      const x = fixtures(stress);
      const setup = on("near", f, stress);
      const r = { ...x.short.route, leftMin: 22, arriveAt: at(13, 47), km: 21 };
      f.nav.state = { kind: "guiding", guidance: guidance(r) };
      const ep = x.long.media.item;
      const d = ep.durationSec ?? 5702;
      f.listening.nowPlaying = playing(ep, d - 18 * 60);
      const next = x.library.podcasts[2] ?? ep;
      return { setup, extras: { next } };
    },
  },
  {
    id: "fuel",
    label: "(c) Fuel low",
    situation: "Fuel is low: the range is shorter than the distance left. The co-driver suggests the 2 fuel stations ahead.",
    build: (f, stress) => {
      const x = fixtures(stress);
      const setup = on("near", f, stress);
      f.listening.nowPlaying = x.music;
      const first = stress
        ? place("Kessler Junction Truck Stop and Travel Plaza Fuel Centre", "1150 Larch Avenue, North Harbour, Westmarch County WX-0417")
        : place("Harbour Fuel", "1150 Larch Avenue, North Harbour");
      return {
        setup,
        extras: {
          range: 38_000,
          suggest: [
            { place: first, meters: 4_200, detourMin: 1, icon: "fuel" },
            { place: place("Route 9 Services", "Route 9, Fernley"), meters: 21_000, detourMin: 3, icon: "fuel" },
          ],
        },
      };
    },
  },
  {
    id: "parked",
    label: "(d) Parked at the destination",
    situation: "Parked at the destination after a 3-hour drive. Show a trip summary and what to do next.",
    build: (f, stress) => {
      const x = fixtures(stress);
      const setup = on("arrived", f, stress);
      const to = place("Port Ellery", "Harbour Ring Road, Port Ellery");
      const g = guidance({ ...x.long.route, to, km: 312, leftMin: 184, arriveAt: NOW, progress: 1 }, { metersLeft: 0, progress: 1 });
      f.nav.state = { kind: "arrived", destination: to };
      const ep = x.long.media.item;
      f.listening.nowPlaying = playing(ep, 4100, "paused");
      return {
        setup: { ...setup, memory: { lastGuidance: g, arrivedAt: NOW } },
        extras: {
          summary: { meters: 312_000, min: 184, stops: 1 },
          suggest: [
            { place: place("Ferry Café", "2 Quay Street, Port Ellery"), meters: 200, icon: "food" },
            { place: place("Port Ellery Fuel", "Harbour Ring Road, Port Ellery"), meters: 1_400, icon: "fuel" },
          ],
          next: x.library.podcasts[1] ?? item("podcasts", "p-field", "Field notes: the quiet county roads", "Field Notes", { durationSec: 4200 }),
        },
      };
    },
  },
];

export const sceneById = (id: string): Scene | undefined => SCENES.find((s) => s.id === id);
