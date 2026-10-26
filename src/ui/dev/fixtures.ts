/**
 * Dev-only fixture data, in the contract's shapes. Fictional and generic: no real places, people
 * or shows. Ported from the Signal mockup's data.js and area data files.
 *   NORMAL: what a calm drive looks like most days.
 *   WORST:  the worst real value for every field, side by side (60-character roads, a word with no
 *           break points, a 68-character place, 900 km arriving the next day, 132 km/h over 100,
 *           100-character episodes, a 5 h book, 7 stops on the way, many rows).
 */
import { coDriverInfo } from "../../codriver/names";
import type { CoDriverInfo, Guidance, Item, Maneuver, NowPlaying, Place, Route, Shelf, Stop } from "../app/contract";

const art = (name: string): string => new URL(`./art/${name}.svg`, import.meta.url).href;

/** The dev page's clock: Monday 26 October 2026, 1:25 PM, local time. */
export const NOW = new Date(2026, 9, 26, 13, 25).getTime();
const at = (h: number, m: number, dayOffset = 0): number => new Date(2026, 9, 26 + dayOffset, h, m).getTime();

const SHOW = "The Long Weekend Show";
const long = (t: string): string => `${SHOW} ${t} | ${SHOW}`;
const NO_BREAK = "Wolkenkratzerhauptverbindungsstraße";
const HOSPITAL = "Saint Augustine Hospital, North Harbour Outpatient Buildings";

let pid = 0;
const place = (name: string, address?: string): Place => {
  pid++;
  return { name, ...(address ? { address } : {}), lat: 0.2 + pid * 0.001, lng: -0.3 - pid * 0.001 };
};

// ---- Routes and guidance --------------------------------------------------------------------------
export interface RouteFix {
  to: Place;
  arriveAt: number;
  leftMin: number;
  km: number;
  progress: number;
  /** The road the car is on (the Stop before the next). */
  road: string;
  next: { maneuver: Maneuver; meters: number; street: string; instruction?: string; exit?: number };
  thenStop?: { maneuver: Maneuver; street: string };
  /** Stops on the way: the place and where it sits (0..1). */
  via?: readonly { place: Place; at: number }[];
  nextVia?: { place: Place; min: number; arriveAt: number };
}

export function guidance(f: RouteFix, extra: Partial<Guidance> = {}): Guidance {
  const total = f.km * 1000;
  const startM = total * f.progress;
  const stop = (index: number, maneuver: Maneuver, street: string, routeMeters: number, more: Partial<Stop> = {}): Stop => ({
    index,
    maneuver,
    street,
    instruction: more.instruction ?? street,
    at: { lat: 0.2, lng: -0.3 },
    routeMeters,
    ...more,
  });
  const stops: Stop[] = [stop(0, "straight", f.road, Math.max(0, startM - 500))];
  const next = stop(1, f.next.maneuver, f.next.street, startM + f.next.meters, {
    ...(f.next.instruction ? { instruction: f.next.instruction } : {}),
    ...(f.next.exit !== undefined ? { exit: f.next.exit } : {}),
  });
  stops.push(next);
  let thenStop: Stop | undefined;
  if (f.thenStop) {
    thenStop = stop(2, f.thenStop.maneuver, f.thenStop.street, next.routeMeters + 200);
    stops.push(thenStop);
  }
  for (const v of f.via ?? []) stops.push(stop(stops.length, "arrive", v.place.name, v.at * total, { at: { lat: v.place.lat, lng: v.place.lng } }));
  const end = stop(stops.length, "arrive", f.to.name, total);
  if (f.next.maneuver !== "arrive") stops.push(end);
  stops.sort((a, b) => a.routeMeters - b.routeMeters);
  const route: Route = {
    destination: f.to,
    via: (f.via ?? []).map((v) => v.place),
    stops,
    shape: "",
    totalMeters: total,
    totalSec: f.leftMin * 60,
    fetchedAt: NOW,
  };
  return {
    route,
    nextStop: next,
    ...(thenStop ? { thenStop } : {}),
    metersToNext: f.next.meters,
    secToNext: Math.round(f.next.meters / 15),
    progress: f.progress,
    legProgress: 0.3,
    metersLeft: total,
    secLeft: f.leftMin * 60,
    arriveAt: f.arriveAt,
    offRoute: false,
    offline: false,
    ...(f.nextVia ? { nextVia: { place: f.nextVia.place, metersTo: 12_000, secTo: f.nextVia.min * 60, arriveAt: f.nextVia.arriveAt } } : {}),
    ...extra,
  };
}

// ---- Media --------------------------------------------------------------------------------------------
export const item = (source: Item["source"], id: string, title: string, by: string, more: Partial<Item> = {}): Item => ({ source, id, title, by, ...more });
export const playing = (it: Item, positionSec: number, transport: NowPlaying["transport"] = "playing", error?: string): NowPlaying => ({
  item: it,
  transport,
  positionSec,
  ...(error ? { error } : {}),
});

export interface Fixtures {
  clock: string;
  speed: { now: number; limit: number };
  overSpeed: { now: number; limit: number };
  short: { route: RouteFix; media: NowPlaying };
  long: { route: RouteFix; media: NowPlaying };
  shelf: Shelf;
  book: NowPlaying;
  music: NowPlaying;
  library: { podcasts: Item[]; music: Item[]; books: Item[] };
  libSearch: { query: string; results: Item[] };
  offlineDownloaded: number[];
  roundabout: RouteFix["next"];
  thenTurn: NonNullable<RouteFix["thenStop"]>;
  via: { place: Place; min: number; arriveAt: number; ticks: number[] };
  arriving: { meters: number; leftMin: number; progress: number };
  places: { saved: Place[]; recent: Place[] };
  plan: {
    typing: string;
    query: string;
    missQuery: string;
    results: Place[];
    saveName: string;
    stopQuery: string;
    stopResults: Place[];
    via: { place: Place; at: number }[];
  };
  error: { source: "podcasts" | "books"; text: string };
  codriver: { heard: string; answer: string; at: number; current: CoDriverInfo; list: CoDriverInfo[] };
  boot: string;
  trips: { queued: number; error?: string };
  wakeProgress: number;
  setup: { location: "prompt" | "granted"; mic: "prompt" | "granted" };
}

function normal(): Fixtures {
  const northgate = place("Northgate", "Westmarch County");
  const harbourFuel = place("Harbour Fuel", "1150 Larch Avenue, North Harbour");
  const tide = item("music", "m-tide", "Low Tide Hours", "Paper Lanterns", { from: "Harbour Lights", artUrl: art("tide"), durationSec: 542 });
  const ferries = item("podcasts", "p-ferries", "Ferries, tolls and the long way round", SHOW, { artUrl: art("weekend"), durationSec: 5702 });
  const saltRoad = item("books", "b-salt", "The Salt Road", "M. A. Fenwick", { artUrl: art("lantern"), durationSec: 1520 });
  return {
    clock: "1:25 PM",
    speed: { now: 62, limit: 70 },
    overSpeed: { now: 82, limit: 70 },
    short: {
      route: { to: northgate, arriveAt: at(14, 17), leftMin: 52, km: 54, progress: 0.06, road: "Mill Road", next: { maneuver: "right", meters: 400, street: "Larch Avenue" } },
      media: playing(tide, 221),
    },
    long: {
      route: { to: place("Port Ellery"), arriveAt: at(19, 45), leftMin: 380, km: 465, progress: 0.04, road: "Route 9", next: { maneuver: "right", meters: 64_000, street: "Route 14" } },
      media: playing(ferries, 2460),
    },
    shelf: { music: tide, podcasts: ferries, books: item("books", "b-salt", "The Salt Road", "M. A. Fenwick", { artUrl: art("lantern"), durationSec: 14400 }) },
    book: playing(saltRoad, 610),
    music: playing(tide, 221),
    library: {
      podcasts: [
        ferries,
        item("podcasts", "p-field", "Field notes: the quiet county roads", "Field Notes", { artUrl: art("field"), durationSec: 4200 }),
        item("podcasts", "p-bridge", "Why every bridge looks different", SHOW, { artUrl: art("weekend"), durationSec: 4440 }),
        item("podcasts", "p-signals", "Signals: how a traffic light decides", "Static Hour", { artUrl: art("static"), durationSec: 2880 }),
      ],
      music: [
        item("music", "m-tide", "Harbour Lights", "Paper Lanterns", { artUrl: art("tide"), durationSec: 2880 }),
        item("music", "m-copper", "Copper Wire", "The Fennel Trio", { artUrl: art("copper"), durationSec: 2460 }),
        item("music", "m-ferry", "Night Ferry", "Isla Moreno", { artUrl: art("ferry"), durationSec: 3720 }),
        item("music", "m-sun", "Sunroom", "Meadow Lark", { artUrl: art("sun"), durationSec: 2160 }),
      ],
      books: [
        saltRoad,
        item("books", "b-maps", "A Map of Small Harbours", "Elin Marsh", { artUrl: art("harbours"), durationSec: 26400 }),
        item("books", "b-ledger", "The Lighthouse Ledger", "Tomas Reyes", { durationSec: 14700 }),
      ],
    },
    libSearch: {
      query: "bridge",
      results: [
        item("podcasts", "p-bridge", "Why every bridge looks different", SHOW, { artUrl: art("weekend"), durationSec: 4440 }),
        item("podcasts", "p-twice", "The bridge that opens twice a day", "Field Notes", { artUrl: art("field"), durationSec: 3120 }),
        item("podcasts", "p-under", "Bridges, tunnels and the long way under", "Static Hour", { artUrl: art("static"), durationSec: 3780 }),
      ],
    },
    offlineDownloaded: [0, 1],
    roundabout: { maneuver: "roundabout", meters: 250, street: "", instruction: "Take the 2nd exit onto Quarry Lane", exit: 2 },
    thenTurn: { maneuver: "left", street: "Route 9" },
    via: { place: harbourFuel, min: 18, arriveAt: at(13, 43), ticks: [0.38] },
    arriving: { meters: 200, leftMin: 1, progress: 0.99 },
    places: {
      saved: [place("Home", "14 Larch Avenue, North Harbour"), place("Work", "Mill Road Studios, Fernley")],
      recent: [northgate, harbourFuel, place("Fernley Market", "Market Square, Fernley"), place("Kessler Junction", "Route 9")],
    },
    plan: {
      typing: "Northg",
      query: "Northgate",
      missQuery: "Northgte",
      results: [
        northgate,
        place("Northgate Library", "2 Market Street, Northgate"),
        place("Northgate Station", "Station Road, Northgate"),
        place("Northgate Road", "Fernley"),
        place("Northgate Garage", "18 Mill Road, North Harbour"),
      ],
      saveName: "Home",
      stopQuery: "Fuel",
      stopResults: [harbourFuel, place("Route 9 Services", "Route 9, Fernley"), place("Kessler Fuel Stop", "Kessler Junction")],
      via: [{ place: harbourFuel, at: 0.55 }],
    },
    error: { source: "podcasts", text: "Can't reach Ossicle" },
    codriver: {
      heard: "Find a gas station on the way",
      answer: "Harbour Fuel on Larch Avenue, 2 minutes ahead. Add it as a stop?",
      at: 0.8,
      current: coDriverInfo("navigator"),
      list: [
        coDriverInfo("navigator"),
        coDriverInfo("companion"),
        coDriverInfo("guide"),
      ],
    },
    boot: "The config has no route server address.",
    trips: { queued: 0 },
    wakeProgress: 6.3 / 18,
    setup: { location: "prompt", mic: "prompt" },
  };
}

function worst(): Fixtures {
  const hospital = place(HOSPITAL, "1700 Saint Augustine Memorial Parkway, North Harbour, Westmarch County");
  const longPlace = (name = "Harbour Fuel") => place(name, "1150 Larch Avenue, North Harbour, Westmarch County WX-0417, Northern Reach");
  const episode = item("podcasts", "p-493", `Marta Ilves: Tidal Bridges, Ferry Timetables, Lighthouses, and Port Towns | ${SHOW} #493`, SHOW, {
    artUrl: art("weekend"),
    durationSec: 18612,
  });
  const book = item("books", "b-salt", "The Salt Road: A Novel of the Northern Coast and the Last Lighthouse", "Margaret Anne Fenwick-Delacroix", { durationSec: 18600 });
  const sunroom = item("music", "m-sun", "Everything We Left at the Harbour Before the Last Ferry Home", "Paper Lanterns and the North Harbour Late Night Orchestra", {
    from: "Sunroom: Live from the Glasshouse Theatre, North Harbour, Second Night",
    artUrl: art("sun"),
    durationSec: 1260,
  });
  const viaNames = [
    longPlace(),
    place("Route 9 Services", "Route 9 Northbound Express"),
    place("Kessler Junction Service Road and Truck Stop Access Lane", "Kessler Junction"),
    place(NO_BREAK, "Kessler Junction, Westmarch County"),
    place("Coast Road Services", "Coast Road, Saltmarsh"),
    place("Gran's", "7 Saltmarsh Lane, Port Ellery"),
    place("North Harbour Ferry Terminal, Long Stay Car Park", "Harbour Ring Road, North Harbour"),
  ];
  const ticks = [0.05, 0.17, 0.22, 0.4, 0.54, 0.67, 0.98];
  const savedExtra: [string, string][] = [
    ["Gran's", "7 Saltmarsh Lane, Port Ellery"],
    ["Gym", "Harbour Leisure Centre, North Harbour"],
    ["School", "North Harbour Primary School, Church Street"],
    ["Ferry terminal", "Harbour Ring Road, North Harbour"],
    ["Garage", "18 Mill Road, North Harbour"],
    ["Market", "Market Square, Fernley"],
    ["Library", "2 Market Street, Northgate"],
    ["Lake house", "Lakeside Drive, East Rim"],
    ["Office annex", "Kessler Junction Service Road"],
    [NO_BREAK, "Kessler Junction, Westmarch County"],
  ];
  const recentNames = [
    "Northgate", "Fernley Market", "Kessler Junction", "Port Ellery Ferry Terminal", "East Rim Visitor Centre", "Saltmarsh Nature Reserve",
    "Westfield Retail Park", "Lower Marsh Lane Allotments", "Coast Road Services", "North Harbour Lighthouse", "Fenwick Hall",
    "Route 14 Truck Stop", "Old Quarry Road Car Park", "Larch Avenue Library", "Mill Road Studios", "The Kingsbridge Arms", "Harbour Leisure Centre",
  ];
  const WEEKEND = { artUrl: art("weekend") };
  return {
    clock: "12:59 PM",
    speed: { now: 96, limit: 100 },
    overSpeed: { now: 132, limit: 100 },
    short: {
      route: {
        to: hospital,
        arriveAt: at(1, 10, 1),
        leftMin: 705,
        km: 900,
        progress: 0.02,
        road: "Upper Kingsbridge Road toward Westfield and Lower Marsh Lane",
        next: { maneuver: "right", meters: 1_900, street: "Saint Augustine Memorial Parkway and County Route 1700 North" },
      },
      media: playing(episode, 7380),
    },
    long: {
      route: {
        to: hospital,
        arriveAt: at(1, 10, 1),
        leftMin: 705,
        km: 900,
        progress: 0.02,
        road: "Upper Kingsbridge Road toward Westfield and Lower Marsh Lane",
        next: { maneuver: "right", meters: 312_000, street: "Old Quarry Road toward North Harbour and the East Rim Bypass" },
      },
      media: playing(episode, 7380),
    },
    shelf: {
      music: item("music", "m-sh", "Everything We Left at the Harbour Before the Last Ferry Home", "Paper Lanterns and the North Harbour Late Night Orchestra", { artUrl: art("tide") }),
      podcasts: item("podcasts", "p-211", long("#211: Ferries, tolls and the long way round the bay"), SHOW, WEEKEND),
      books: item("books", "b-sh", "The Salt Road: A Novel of the Northern Coast and the Last Lighthouse", "Margaret Anne Fenwick-Delacroix", { artUrl: art("lantern") }),
    },
    book: playing(book, 17999),
    music: playing(sunroom, 221),
    library: {
      podcasts: [
        episode,
        item("podcasts", "p-211", long("#211: Ferries, tolls and the long way round the bay"), SHOW, { ...WEEKEND, durationSec: 18600 }),
        item("podcasts", "p-210", long("#210: A short history of the roadside motel, told badly"), SHOW, { ...WEEKEND, durationSec: 18960 }),
        item("podcasts", "p-209", long("#209: What the lighthouse keeper saw in winter 1962"), SHOW, { ...WEEKEND, durationSec: 17280 }),
        item("podcasts", "p-field", "Field notes: the quiet county roads between Fernley and Kessler Junction", "Field Notes from the Long Road Home", { artUrl: art("field"), durationSec: 18120 }),
        item("podcasts", "p-signals", "Signals: how a traffic light decides, and why it sometimes gets it wrong", "Static Hour", { artUrl: art("static"), durationSec: 14340 }),
        item("podcasts", "p-super", "Supercalifragilisticexpialidociousandthensomeuntilitbreaks", "Static Hour", { artUrl: art("static"), durationSec: 21540 }),
      ],
      music: [
        item("music", "m-sun", "Sunroom: Live from the Glasshouse Theatre, North Harbour, Second Night", "Paper Lanterns and the North Harbour Late Night Orchestra", { artUrl: art("sun"), durationSec: 9660 }),
        item("music", "m-nb", NO_BREAK, "Die Fennel Trio", { artUrl: art("copper"), durationSec: 2460 }),
        item("music", "m-ferry", "Night Ferry (Deluxe Edition with Demos, Outtakes and Live Recordings)", "Isla Moreno", { artUrl: art("ferry"), durationSec: 10920 }),
        item("music", "m-tide", "Harbour Lights", "Paper Lanterns", { artUrl: art("tide"), durationSec: 2880 }),
        item("music", "m-copper", "Copper Wire", "The Fennel Trio", { artUrl: art("copper"), durationSec: 2460 }),
        item("music", "m-field", "Field Recordings from the Coast Road, Volume Two", "Meadow Lark", { durationSec: 4680 }),
      ],
      books: [
        book,
        item("books", "b-maps", "A Map of Small Harbours and the People Who Kept Them Through the Long Winters", "Elin Marsh-Abernathy", { artUrl: art("harbours"), durationSec: 42000 }),
        item("books", "b-nb", NO_BREAK, "Tomas Reyes", { artUrl: art("lantern"), durationSec: 21540 }),
        item("books", "b-ledger", "The Lighthouse Ledger", "Tomas Reyes", { durationSec: 14700 }),
      ],
    },
    libSearch: { query: NO_BREAK, results: [] },
    offlineDownloaded: [0],
    roundabout: { maneuver: "roundabout", meters: 1_900, street: "Saint Augustine Memorial Parkway and County Route 1700 North", exit: 9 },
    thenTurn: { maneuver: "sharp-left", street: "Kessler Junction Service Road and Truck Stop Access Lane" },
    via: {
      place: place("Kessler Junction Truck Stop and Travel Plaza Fuel Centre, 1150 Larch Avenue, North Harbour WX-0417"),
      min: 192,
      arriveAt: at(16, 11),
      ticks: [0.27, 0.36, 0.48, 0.6, 0.71, 0.83, 0.92],
    },
    arriving: { meters: 350, leftMin: 2, progress: 0.998 },
    places: {
      saved: [
        place("Home", "14 Larch Avenue, North Harbour, Westmarch County WX-0417, Northern Reach"),
        place("Work", "Mill Road Studios, Unit 4, Fernley Business Park, Fernley"),
        ...savedExtra.map(([n, a]) => place(n, a)),
      ],
      recent: [longPlace(), place(HOSPITAL, "1700 Saint Augustine Memorial Parkway, North Harbour"), place(NO_BREAK, "Kessler Junction"), ...recentNames.map((n) => place(n, "Westmarch County"))],
    },
    plan: {
      typing: NO_BREAK,
      query: NO_BREAK,
      missQuery: NO_BREAK,
      results: [
        place(NO_BREAK, "Kessler Junction, Westmarch County WX-0417, Northern Reach"),
        hospital,
        longPlace(),
        place(`${NO_BREAK} Nord`, "Kessler Junction"),
        place(`${NO_BREAK} Süd, Busbahnhof und Parkhaus am Westufer`, "Kessler Junction, Westmarch County"),
        place("Upper Kingsbridge Road toward Westfield and Lower Marsh Lane", "Westfield"),
        place("Kessler Junction Service Road and Truck Stop Access Lane", "Kessler Junction"),
        place("North Harbour Ferry Terminal, Long Stay Car Park", "Harbour Ring Road, North Harbour"),
      ],
      saveName: NO_BREAK,
      stopQuery: "Fuel open late on the Coast Road toward Port Ellery and Saltmarsh",
      stopResults: [
        longPlace(),
        place("Kessler Junction Service Road and Truck Stop Access Lane", "Kessler Junction"),
        place(NO_BREAK, "Kessler Junction, Westmarch County"),
        place("Coast Road Services", "Coast Road, Saltmarsh"),
        place("Harbour Ring Road Fuel", "Harbour Ring Road, North Harbour"),
      ],
      via: viaNames.map((p, i) => ({ place: p, at: ticks[i] ?? 0.5 })),
    },
    error: { source: "books", text: "Ossicle hasn't narrated this chapter yet" },
    codriver: {
      heard: "Find a gas station on the way that is open late, then remind me to call the garage about Friday",
      answer:
        "Harbour Fuel on Larch Avenue is 2 minutes ahead and open until midnight. Kessler Junction Truck Stop is 18 minutes ahead, with cheaper diesel, a quiet rest area and a café that drivers call the best coffee on Route 9 after dark. Your garage reminder is set for Friday at 9 AM. Add Harbour Fuel as a stop?",
      at: 0.45,
      current: { id: "navigator-overnight-long-haul-calm-voice" },
      list: [
        coDriverInfo("navigator"),
        coDriverInfo("companion"),
        coDriverInfo("guide"),
        { id: "navigator-overnight-long-haul-calm-voice" },
        { id: "wolkenkratzerhauptverbindungsstrasse-guid", displayName: NO_BREAK },
        { id: "co-driver-for-the-school-run-and-errands" },
      ],
    },
    boot: "The config at /config.json has no route server address (valhalla is missing or empty). Wolkenkratzerhauptverbindungsstraße",
    trips: { queued: 4812, error: "Can't reach the trip server. Positions send when signal returns." },
    wakeProgress: 17.9 / 18,
    setup: { location: "granted", mic: "prompt" },
  };
}

export function fixtures(stress: boolean): Fixtures {
  pid = 0;
  return stress ? worst() : normal();
}
