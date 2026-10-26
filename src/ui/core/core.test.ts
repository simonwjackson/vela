import { arrival, cleanTitle, distanceParts, duration, placeName, shortRoad } from "./format";
import { morph } from "./morph";
import { FULL_SHEET_BELOW, ROW_FLOW_RATIO, SHORT_FRAME_H, plan } from "./plan";

describe("plan(w, h): layout from the container alone", () => {
  test("the four Fold postures", () => {
    expect(plan(932, 553)).toMatchObject({ flow: "row", m: 33, hero: 127, road: 31, side: "336px", art: 64 });
    expect(plan(704, 783)).toMatchObject({ flow: "col", m: 42, hero: 120, road: 29, side: "1fr", art: 64 });
    expect(plan(711, 374)).toMatchObject({ flow: "row", m: 24, hero: 79, road: 21, side: "256px", art: 48 });
    expect(plan(475, 638)).toMatchObject({ flow: "col", m: 29, hero: 98, road: 24, art: 64 });
  });

  test("row flow from a 1.2 ratio; one px either side", () => {
    expect(ROW_FLOW_RATIO).toBe(1.2);
    expect(plan(600, 500).flow).toBe("row");
    expect(plan(599, 500).flow).toBe("col");
  });

  test("the short scale under 430 px tall", () => {
    expect(plan(900, SHORT_FRAME_H - 1).art).toBe(48);
    expect(plan(900, SHORT_FRAME_H).art).toBe(64);
  });

  test("margins and the road size never go under their floors", () => {
    expect(plan(300, 200)).toMatchObject({ m: 24, road: 20 });
    expect(FULL_SHEET_BELOW).toBe(300);
  });
});

describe("text rules", () => {
  test("cleanTitle strips the show name a podcast title repeats", () => {
    const show = "The Long Weekend Show";
    expect(cleanTitle(`Marta Ilves: Tidal Bridges | ${show} #493`, show)).toBe("Marta Ilves: Tidal Bridges");
    expect(cleanTitle(`${show} #211: ferries and tolls | ${show}`, show)).toBe("Ferries and tolls");
    expect(cleanTitle("Low Tide Hours", "Paper Lanterns")).toBe("Low Tide Hours");
  });

  test("shortRoad: strips toward, then the verb, then a roundabout exit", () => {
    expect(shortRoad("Old Quarry Road toward North Harbour and the East Rim Bypass")).toBe("Old Quarry Road");
    expect(shortRoad("Turn right onto Larch Avenue toward Northgate")).toBe("Larch Avenue");
    expect(shortRoad("Take the 2nd exit onto Quarry Lane")).toBe("Quarry Lane");
    expect(shortRoad("Saint Augustine Memorial Parkway and County Route 1700 North")).toBe("Saint Augustine Memorial Parkway and County Route 1700 North");
  });

  test("numbers", () => {
    expect(duration(705)).toBe("11 h 45 min");
    expect(duration(52)).toBe("52 min");
    expect(duration(120)).toBe("2 h");
    expect(distanceParts(1_900)).toEqual({ num: "1.9", unit: "km" });
    expect(distanceParts(400)).toEqual({ num: "400", unit: "m" });
    expect(distanceParts(9_990)).toEqual({ num: "10", unit: "km" });
    expect(distanceParts(312_000)).toEqual({ num: "312", unit: "km" });
    expect(placeName("Harbour Fuel, 1150 Larch Avenue")).toBe("Harbour Fuel");
  });

  test("arrival names the day only when it is not today", () => {
    const now = new Date(2026, 9, 26, 13, 25).getTime();
    expect(arrival(new Date(2026, 9, 26, 14, 17).getTime(), now)).toBe("2:17 PM");
    expect(arrival(new Date(2026, 9, 27, 1, 10).getTime(), now)).toBe("Tue 1:10 AM");
  });
});

describe("morph: patching keeps live nodes", () => {
  test("a focused input keeps its node and the driver's text", () => {
    const live = document.createElement("div");
    live.innerHTML = '<section data-key="where"><input data-key="q" value=""></section>';
    document.body.append(live);
    const input = live.querySelector("input") as HTMLInputElement;
    input.focus();
    input.value = "North";
    const next = document.createElement("div");
    next.innerHTML = '<div data-key="top">1:25 PM</div><section data-key="where"><input data-key="q" value="N"></section>';
    morph(live, next);
    expect(live.querySelector("input")).toBe(input);
    expect(input.value).toBe("North");
    expect(live.firstElementChild?.textContent).toBe("1:25 PM");
    live.remove();
  });
});
