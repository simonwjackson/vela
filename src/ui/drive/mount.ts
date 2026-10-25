/**
 * Plain reference UI for driving. No styling on purpose: the visual design is not decided.
 * It shows every NavEngine state and readout as text, plus destination entry.
 */
import type { Guidance, NavEngine, NavState, Place, Readouts, Stop } from "../../contract";
import type { TripsStatus } from "../../trips/reporter";
import { formatArrival, formatDistance, formatDuration, formatPercent } from "./format";

export interface DriveDeps {
  readonly nav: NavEngine;
  /** Optional: shows the Trips queue when the shell passes the reporter. */
  readonly trips?: { subscribe(listener: (status: TripsStatus) => void): () => void };
  readonly now?: () => number;
}

/** Valhalla words an arrival in the past tense ("You have arrived"); ahead of time it is "Arrive at". */
function stopText(stop: Stop): string {
  return stop.maneuver === "arrive" ? `Arrive at ${stop.street || "the destination"}` : stop.instruction;
}

export function mount(root: HTMLElement, deps: DriveDeps): () => void {
  const { nav } = deps;
  const now = deps.now ?? Date.now;
  const doc = root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const container = el("section");
  container.setAttribute("aria-label", "Drive");

  const guidanceBox = el("div");
  guidanceBox.dataset.part = "guidance";
  const readoutsBox = el("p");
  readoutsBox.dataset.part = "readouts";
  const tripsBox = el("p");
  tripsBox.dataset.part = "trips";

  const form = el("form");
  const query = el("input");
  query.type = "search";
  query.name = "q";
  query.placeholder = "Where to?";
  query.setAttribute("aria-label", "Search for a place");
  const searchButton = el("button", "Search");
  searchButton.type = "submit";
  form.append(query, searchButton);
  const searchStatus = el("p");
  searchStatus.dataset.part = "search-status";
  const results = el("ul");
  results.dataset.part = "results";
  const savedList = el("ul");
  savedList.dataset.part = "saved";
  const recentList = el("ul");
  recentList.dataset.part = "recent";

  container.append(
    guidanceBox,
    readoutsBox,
    tripsBox,
    el("h2", "Destination"),
    form,
    searchStatus,
    results,
    el("h3", "Saved places"),
    savedList,
    el("h3", "Recent destinations"),
    recentList,
  );
  root.append(container);

  let current: NavState = nav.state;

  function onRoute(): boolean {
    return current.kind === "guiding" || current.kind === "rerouting";
  }

  function placeRow(place: Place, extra: (li: HTMLLIElement) => void): HTMLLIElement {
    const li = el("li");
    const start = el("button", place.address ? `${place.name}, ${place.address}` : place.name);
    start.type = "button";
    start.dataset.action = "go";
    start.addEventListener("click", () => void nav.start(place));
    li.append(start);
    extra(li);
    return li;
  }

  function renderPlaces(): void {
    savedList.replaceChildren(...nav.savedPlaces().map((p) => placeRow(p, () => {})));
    if (savedList.childElementCount === 0) savedList.append(el("li", "None yet"));
    recentList.replaceChildren(...nav.recentDestinations().map((p) => placeRow(p, () => {})));
    if (recentList.childElementCount === 0) recentList.append(el("li", "None yet"));
  }

  function renderResults(places: readonly Place[]): void {
    results.replaceChildren(
      ...places.map((place) =>
        placeRow(place, (li) => {
          if (onRoute()) {
            const via = el("button", "Add as stop");
            via.type = "button";
            via.dataset.action = "via";
            via.addEventListener("click", () => {
              nav.addWaypoint(place).catch((error: unknown) => {
                searchStatus.textContent = error instanceof Error ? error.message : String(error);
              });
            });
            li.append(" ", via);
          }
          const save = el("button", "Save as…");
          save.type = "button";
          save.dataset.action = "save";
          save.addEventListener("click", () => {
            const name = globalThis.prompt?.("Name this place", place.name);
            if (!name) return;
            nav.savePlace(name, place);
            renderPlaces();
          });
          li.append(" ", save);
        }),
      ),
    );
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = query.value.trim();
    if (!q) return;
    searchStatus.textContent = "Searching…";
    nav.search(q).then(
      (places) => {
        searchStatus.textContent = places.length ? "" : "No places found";
        renderResults(places);
      },
      (error: unknown) => {
        searchStatus.textContent = error instanceof Error ? error.message : String(error);
        renderResults([]);
      },
    );
  });

  function guidanceLines(g: Guidance, rerouting: boolean): string[] {
    const t = now();
    const lines = [
      stopText(g.nextStop),
      `in ${formatDistance(g.metersToNext)} (${formatDuration(g.secToNext)})`,
      g.thenStop ? `then ${stopText(g.thenStop)}` : "then you are there",
      `${formatDistance(g.metersLeft)} left, ${formatDuration(g.secLeft)}, arrive ${formatArrival(g.arriveAt, t)}`,
      `trip ${formatPercent(g.progress)}, this leg ${formatPercent(g.legProgress)}`,
      `to ${g.route.destination.name}`,
    ];
    if (rerouting) lines.push("Finding a new route…");
    else if (g.offRoute) lines.push(g.offline ? "Off route. No signal: guiding from the saved route." : "Off route.");
    else if (g.offline) lines.push("No signal: guiding from the saved route.");
    return lines;
  }

  function renderState(state: NavState): void {
    const lines: string[] = [];
    switch (state.kind) {
      case "idle":
        lines.push("No route. Choose a destination.");
        break;
      case "routing":
        lines.push(`Finding a route to ${state.destination.name}…`);
        break;
      case "guiding":
        lines.push(...guidanceLines(state.guidance, false));
        break;
      case "rerouting":
        lines.push(...guidanceLines(state.guidance, true));
        break;
      case "arrived":
        lines.push(`Arrived at ${state.destination.name}`);
        break;
      case "error":
        lines.push(state.message);
        break;
    }
    const children: HTMLElement[] = lines.map((line, i) => el(i === 0 ? "h1" : "p", line));
    if (state.kind !== "idle") {
      const endButton = el("button", state.kind === "guiding" || state.kind === "rerouting" ? "End route" : "Clear");
      endButton.type = "button";
      endButton.dataset.action = "end";
      endButton.addEventListener("click", () => nav.end());
      children.push(endButton);
    }
    guidanceBox.dataset.state = state.kind;
    guidanceBox.replaceChildren(...children);
  }

  function renderReadouts(r: Readouts): void {
    const parts = [
      r.clock,
      r.speedKmh !== undefined ? `${Math.round(r.speedKmh)} km/h` : "speed –",
      r.speedLimitKmh !== undefined ? `limit ${Math.round(r.speedLimitKmh)}` : "limit unknown",
      r.daylight ? "daylight contrast on" : "daylight contrast off",
    ];
    readoutsBox.textContent = parts.join(" · ");
  }

  const unsubscribeNav = nav.subscribe((state, readouts) => {
    const kindChanged = state.kind !== current.kind;
    current = state;
    renderState(state);
    renderReadouts(readouts);
    if (kindChanged) renderPlaces();
  });
  const unsubscribeTrips = deps.trips?.subscribe((s) => {
    tripsBox.textContent = `Trips: ${s.moving ? "moving" : "parked"}, ${s.queued} waiting to send${
      s.lastError ? ` (${s.lastError})` : ""
    }`;
  });
  renderPlaces();

  return () => {
    unsubscribeNav();
    unsubscribeTrips?.();
    container.remove();
  };
}
