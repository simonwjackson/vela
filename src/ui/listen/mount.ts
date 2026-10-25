/**
 * Plain reference UI for Listening. System font, no styling: it exists to show every state of
 * the engine, not to decide the design. All text is set with textContent.
 */
import type { Item, Listening, NowPlaying, Shelf, SourceId } from "../../contract";
import type { DownloadStatus, Downloads } from "../../sw/downloads";

export interface ListenMountDeps {
  readonly listening: Listening;
  /** Optional: shows offline download status and the manual Wi-Fi switch. */
  readonly downloads?: Downloads;
}

const SOURCE_NAMES: Readonly<Record<SourceId, string>> = { music: "Music", podcasts: "Podcasts", books: "Books" };
const SOURCES: readonly SourceId[] = ["music", "podcasts", "books"];

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function describeNowPlaying(nowPlaying: NowPlaying | undefined): string {
  if (nowPlaying === undefined) return "Nothing is playing.";
  const { item, transport, positionSec } = nowPlaying;
  const time = item.durationSec === undefined ? formatTime(positionSec) : `${formatTime(positionSec)} / ${formatTime(item.durationSec)}`;
  const from = item.from === undefined ? "" : ` (${item.from})`;
  return `${SOURCE_NAMES[item.source]}: ${item.title} by ${item.by}${from}. ${transport}, ${time}.`;
}

export function describeDownloads(status: DownloadStatus): string {
  const phase = status.phase;
  switch (phase.kind) {
    case "idle":
      return "Downloads have not run yet.";
    case "blocked":
      return phase.network.kind === "blocked" && phase.network.reason === "metered"
        ? "Downloads wait for Wi-Fi."
        : "Downloads are off. This browser cannot tell Wi-Fi from mobile data; turn on the switch while on Wi-Fi.";
    case "planning":
      return "Choosing what to download…";
    case "downloading":
      return `Downloading ${phase.done} of ${phase.total}.`;
    case "done":
      return `${phase.saved} saved for offline, ${phase.failed} failed.`;
  }
}

export function mount(root: HTMLElement, deps: ListenMountDeps): () => void {
  const { listening, downloads } = deps;
  const doc = root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const report = (promise: Promise<unknown>) => {
    promise.catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : String(error);
    });
  };

  const container = el("section");
  container.setAttribute("aria-label", "Listening");

  // Now playing and controls.
  const nowHeading = el("h2", "Now playing");
  const nowText = el("p");
  nowText.setAttribute("aria-live", "polite");
  const errorText = el("p");
  errorText.setAttribute("role", "alert");
  const controls = el("div");
  const back = el("button", "Back");
  const toggle = el("button", "Play");
  const forward = el("button", "Forward");
  back.addEventListener("click", () => report(listening.send({ type: "back" })));
  toggle.addEventListener("click", () => report(listening.send({ type: "toggle" })));
  forward.addEventListener("click", () => report(listening.send({ type: "forward" })));
  controls.append(back, toggle, forward);

  // Shelf.
  const shelfHeading = el("h2", "Shelf");
  const shelfList = el("ul");

  // Search.
  const searchHeading = el("h2", "Search");
  const form = el("form");
  const sourceSelect = el("select");
  sourceSelect.setAttribute("aria-label", "Source");
  for (const source of SOURCES) {
    const option = el("option", SOURCE_NAMES[source]);
    option.value = source;
    sourceSelect.append(option);
  }
  const query = el("input");
  query.type = "search";
  query.setAttribute("aria-label", "Search");
  const submit = el("button", "Search");
  submit.type = "submit";
  form.append(sourceSelect, query, submit);
  const results = el("ul");
  const status = el("p");

  const itemButton = (label: string, item: Item) => {
    const button = el("button", label);
    button.addEventListener("click", () => report(listening.send({ type: "playItem", item })));
    return button;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const source = sourceSelect.value as SourceId;
    status.textContent = `Searching ${SOURCE_NAMES[source]}…`;
    results.replaceChildren();
    report(
      listening.search(source, query.value).then((items) => {
        status.textContent = items.length === 0 ? "No results." : `${items.length} results.`;
        results.replaceChildren(
          ...items.map((item) => {
            const row = el("li", `${item.title} — ${item.by} `);
            row.append(itemButton("Play", item));
            return row;
          }),
        );
      }),
    );
  });

  container.append(nowHeading, nowText, errorText, controls, shelfHeading, shelfList, searchHeading, form, status, results);

  // Downloads.
  let downloadText: HTMLParagraphElement | undefined;
  let downloadList: HTMLUListElement | undefined;
  let manual: HTMLInputElement | undefined;
  let unsubscribeDownloads: () => void = () => undefined;
  if (downloads !== undefined) {
    const heading = el("h2", "Downloads");
    downloadText = el("p");
    const label = el("label", " On Wi-Fi now (when the browser cannot tell)");
    manual = el("input");
    manual.type = "checkbox";
    label.prepend(manual);
    const box = manual;
    box.addEventListener("change", () => {
      downloads.setManualWifi(box.checked);
      report(downloads.run());
    });
    const runNow = el("button", "Download now");
    runNow.addEventListener("click", () => report(downloads.run()));
    downloadList = el("ul");
    container.append(heading, downloadText, label, runNow, downloadList);
  }

  const renderShelf = (shelf: Shelf) => {
    shelfList.replaceChildren(
      ...SOURCES.map((source) => {
        const item = shelf[source];
        const row = el("li", `${SOURCE_NAMES[source]}: ${item === undefined ? "nothing yet" : `${item.title} — ${item.by}`} `);
        if (item !== undefined) {
          const resume = el("button", "Resume");
          resume.addEventListener("click", () => report(listening.send({ type: "resume", source })));
          row.append(resume);
        }
        return row;
      }),
    );
  };

  const render = (nowPlaying: NowPlaying | undefined, shelf: Shelf) => {
    nowText.textContent = describeNowPlaying(nowPlaying);
    errorText.textContent = nowPlaying?.transport === "error" ? (nowPlaying.error ?? "Playback failed.") : "";
    toggle.textContent = nowPlaying?.transport === "playing" ? "Pause" : "Play";
    const disabled = nowPlaying === undefined;
    back.disabled = disabled;
    toggle.disabled = disabled;
    forward.disabled = disabled;
    const talk = nowPlaying !== undefined && nowPlaying.item.source !== "music";
    back.textContent = talk ? "Back 15 s" : "Previous";
    forward.textContent = talk ? "Forward 30 s" : "Next";
    renderShelf(shelf);
  };

  const renderDownloads = (state: DownloadStatus) => {
    if (downloadText === undefined || downloadList === undefined || manual === undefined) return;
    const problems = Object.entries(state.problems).map(([source, message]) => `${SOURCE_NAMES[source as SourceId]}: ${message}`);
    downloadText.textContent = [describeDownloads(state), ...problems].join(" ");
    manual.checked = state.manualWifi;
    downloadList.replaceChildren(
      ...state.items.map((item) =>
        el("li", `${SOURCE_NAMES[item.source]}: ${item.label} — ${item.state}${item.error === undefined ? "" : ` (${item.error})`}`),
      ),
    );
  };

  render(listening.nowPlaying, listening.shelf);
  const unsubscribe = listening.subscribe(({ nowPlaying, shelf }) => render(nowPlaying, shelf));
  if (downloads !== undefined) {
    renderDownloads(downloads.status);
    unsubscribeDownloads = downloads.subscribe(renderDownloads);
  }
  root.append(container);

  return () => {
    unsubscribe();
    unsubscribeDownloads();
    container.remove();
  };
}
