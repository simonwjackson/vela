/**
 * The Vela app: one mount that subscribes to the engines and draws the Signal state that fits.
 *
 *   engines ─┐
 *   ui state ├─ screen() (pure: which state, what data) ─ renderScreen() ─ morph() ─ fit()
 *   memory  ─┘
 *
 * Layout is a function of the frame's size: plan(w, h) runs again on every resize, fold and
 * keyboard change; drafts, sheets and scroll positions survive because the DOM is patched in
 * place. Every target is handled by delegation (data-action, data-field, data-talk).
 */
import "../styles/index.css";
import { h } from "../core/dom";
import { morphChildren } from "../core/morph";
import { plan, planVars } from "../core/plan";
import { fit } from "../view/fit";
import { coverColor, lightFor } from "../view/light";
import type { AppDeps, Item, NavState, Place, Readouts, SourceId, UpdateCheck } from "./contract";
import { inputOf } from "./input";
import { renderScreen } from "./render";
import { type Memory, OVER_LIMIT_MS, type Screen, type ScreenInput, type SheetState, TAP_MS, TOAST_MS, type UiState, bootScreen, overLimit, screen } from "./screen";

export interface MountOptions {
  /** Shown in Settings ("Vela 0.1.0"). */
  version?: string;
  /** Plays a Turn sound now (Settings → Turn sound → Test). Not in AppDeps yet. */
  testTurnSound?: () => void;
  /** Ask for location / the microphone (first run). Default: the browser prompts. */
  requestLocation?: () => void;
  requestMic?: () => void;
  /** Network reachability. Default: navigator.onLine and its events. */
  online?: { get(): boolean; subscribe(fn: () => void): () => void };
  /** The keyboard's inset over the frame. Default: from visualViewport. */
  keyboard?: () => number;
  now?: () => number;
  /** Start with this UI state (the dev page uses it to open a sheet). */
  initial?: Partial<UiState>;
  memory?: Partial<Memory>;
  /** Called after every render with the state that shows (the dev page reports it). */
  onScreen?: (s: Screen) => void;
  /** Dev only: draw the keyboard spacer grey, as the mockup does. */
  dev?: boolean;
  /** Search waits this long after the last key. */
  searchDelayMs?: number;
}

const SEARCH_DELAY_MS = 300;

/** The app. `build` wires this into src/main.ts in place of the two reference mounts. */
export function mount(root: HTMLElement, deps: AppDeps, options: MountOptions = {}): () => void {
  const { nav, listening, downloads, coDriver, wake, settings, app } = deps;
  const now = options.now ?? Date.now;
  const searchDelay = options.searchDelayMs ?? SEARCH_DELAY_MS;
  const win = root.ownerDocument.defaultView ?? window;

  const shell = h("div", { class: "vela", "data-dev": options.dev ? "" : undefined });
  const frame = h("main", { class: "app", "aria-label": "Vela" });
  shell.append(frame);
  root.append(shell);

  let ui: UiState = { typing: false, library: {}, ...options.initial };
  let memory: Memory = { ...options.memory };
  let last: Screen | undefined;
  let navState: NavState = nav.state;
  let readouts: Readouts = nav.readouts;
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!disposed) fn();
    }, ms);
    timers.add(t);
    return t;
  };

  const online = options.online ?? {
    get: () => win.navigator.onLine !== false,
    subscribe: (fn: () => void) => {
      win.addEventListener("online", fn);
      win.addEventListener("offline", fn);
      return () => {
        win.removeEventListener("online", fn);
        win.removeEventListener("offline", fn);
      };
    },
  };
  const keyboardInset = options.keyboard ?? (() => {
    const vv = win.visualViewport;
    return vv ? Math.max(0, win.innerHeight - vv.height) : 0;
  });

  // ---- Memory: what the screen keeps across engine states --------------------------------------
  function remember(state: NavState, r: Readouts): void {
    const t = now();
    if (state.kind === "guiding" || state.kind === "rerouting") memory.lastGuidance = state.guidance;
    if (state.kind === "arrived" && navState.kind !== "arrived") memory.arrivedAt = t;
    if (state.kind !== "arrived") memory.arrivedAt = undefined;
    if (state.kind === "routing") memory.lastDestination = state.destination;
    if (state.kind === "preview") memory.lastDestination = state.route.destination;
    if (overLimit(r)) {
      if (memory.overSince === undefined) {
        memory.overSince = t;
        later(OVER_LIMIT_MS + 50, schedule); // the readouts show after 3 s, even without a new fix
      }
    } else memory.overSince = undefined;
  }
  remember(navState, readouts);
  memory = { ...memory, ...options.memory };

  // ---- Input to the mapping ------------------------------------------------------------------
  const input = (): ScreenInput =>
    inputOf(deps, {
      now: now(),
      online: online.get(),
      ui,
      memory,
      frame: { h: shell.clientHeight, keyboard: ui.typing ? keyboardInset() : 0 },
      version: options.version,
      nav: navState,
      readouts,
    });

  // ---- Render ------------------------------------------------------------------------------------
  let queued = false;
  function schedule(): void {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) render();
    });
  }

  let lightKey = "";
  function setLight(s: Screen): void {
    const l = s.light;
    const key = l ? `${l.source}|${l.art ?? ""}` : "";
    if (key === lightKey) return;
    lightKey = key;
    if (!l) {
      shell.style.setProperty("--light", "var(--accent)");
      shell.style.setProperty("--light-alpha", "5%");
      return;
    }
    shell.style.setProperty("--light", lightFor(undefined, l.source));
    shell.style.setProperty("--light-alpha", "10%");
    if (l.art) {
      void coverColor(l.art).then((c) => {
        if (lightKey === key && !disposed) shell.style.setProperty("--light", lightFor(c, l.source));
      });
    }
  }

  let finishing = false;
  function render(): void {
    const w = shell.clientWidth;
    const hgt = shell.clientHeight;
    const p = plan(w || 932, hgt || 553);
    for (const [k, v] of Object.entries(planVars(p))) frame.style.setProperty(k, v);
    frame.dataset.flow = p.flow;
    const inp = input();
    const s = screen(inp);
    last = s;
    shell.toggleAttribute("data-daylight", s.daylight);
    frame.dataset.state = s.id;
    const next = h("main", null, ...renderScreen(s, { keyboard: inp.frame.keyboard }));
    morphChildren(frame, next);
    fit(frame);
    afterRender(s);
    setLight(s);
    options.onScreen?.(s);
    // First run ends once both permissions have an answer.
    if (app.firstRun && !finishing && app.permissions.location !== "prompt" && app.permissions.mic !== "prompt") {
      finishing = true;
      app.finishFirstRun();
    }
  }

  // Scroll a sheet list to the section the state asked for, once.
  let scrolled = "";
  let opened = "";
  function afterRender(s: Screen): void {
    const sh = s.sheet;
    // Opening a row to name it brings its Save into view: the primary action never waits below the fold.
    const saving = sh?.kind === "where" && sh.saving ? `${sh.saving.list}:${sh.saving.index}` : "";
    if (saving && saving !== opened) {
      const list = frame.querySelector<HTMLElement>(".sheet .list");
      const open = frame.querySelector<HTMLElement>(".plan-saving");
      if (list && open) {
        // Positions inside the list's content, so running again gives the same scroll.
        const lr = list.getBoundingClientRect();
        const or = open.getBoundingClientRect();
        const top = or.top - lr.top + list.scrollTop;
        const bottom = or.bottom - lr.top + list.scrollTop;
        let t = Math.min(list.scrollTop, top - 4);
        t = Math.max(t, bottom + 12 - list.clientHeight); // Save wins when both do not fit
        list.scrollTop = t;
        fit(frame);
      }
    }
    opened = saving;
    const target = sh?.kind === "where" ? sh.scrollTo : sh?.kind === "library" ? sh.scrollTo : undefined;
    if (!target) {
      scrolled = "";
      return;
    }
    if (scrolled === target) return;
    scrolled = target;
    const list = frame.querySelector<HTMLElement>(".sheet .list");
    if (!list) return;
    if (target === "recent") {
      const head = list.querySelector<HTMLElement>('[data-head="recent"]');
      if (head) list.scrollTop += head.getBoundingClientRect().top - list.getBoundingClientRect().top - 4;
    } else {
      list.scrollTop = list.scrollHeight;
      list.toggleAttribute("data-end", true);
    }
    fit(frame);
  }

  // ---- UI state changes --------------------------------------------------------------------------
  function setUi(patch: Partial<UiState>): void {
    ui = { ...ui, ...patch };
    schedule();
  }
  function setSheet(sheet: SheetState | undefined): void {
    setUi({ sheet });
  }
  function patchSheet<K extends SheetState["kind"]>(kind: K, patch: Partial<Extract<SheetState, { kind: K }>>): void {
    if (ui.sheet?.kind !== kind) return;
    setSheet({ ...ui.sheet, ...patch } as SheetState);
  }
  function toast(text: string): void {
    setUi({ toast: { text, icon: "check" } });
    later(TOAST_MS, () => {
      if (ui.toast?.text === text) setUi({ toast: undefined });
    });
  }
  const fail = (p: Promise<unknown>): void => {
    p.catch(() => schedule());
  };

  // ---- Places ------------------------------------------------------------------------------------
  function placeAt(arg: string | undefined): Place | undefined {
    const [list, index] = String(arg ?? "").split(":");
    const i = Number(index);
    if (list === "saved") return nav.savedPlaces()[i];
    if (list === "recent") return nav.recentDestinations()[i];
    const sh = ui.sheet;
    const res = sh?.kind === "where" || sh?.kind === "add-stop" ? sh.results : undefined;
    return res?.status === "ready" ? res.items[i] : undefined;
  }

  let searchSeq = 0;
  function searchPlaces(kind: "where" | "add-stop", query: string, delay = searchDelay): void {
    const seq = ++searchSeq;
    if (!query.trim()) {
      patchSheet(kind, { results: undefined });
      return;
    }
    later(delay, () => {
      if (seq !== searchSeq) return;
      patchSheet(kind, { results: ui.sheet?.kind === kind && ui.sheet.results?.status === "ready" ? ui.sheet.results : { status: "loading" } });
      nav.search(query).then(
        (items) => {
          if (seq === searchSeq) patchSheet(kind, { results: { status: "ready", items } });
        },
        (e: unknown) => {
          if (seq === searchSeq) patchSheet(kind, { results: { status: "error", message: e instanceof Error ? e.message : String(e) } });
        },
      );
    });
  }

  // ---- Library -------------------------------------------------------------------------------------
  function loadLibrary(source: SourceId): void {
    if (ui.library[source]?.status === "ready") return;
    setUi({ library: { ...ui.library, [source]: { status: "loading" } } });
    listening.search(source, "").then(
      (items) => setUi({ library: { ...ui.library, [source]: { status: "ready", items } } }),
      (e: unknown) => setUi({ library: { ...ui.library, [source]: { status: "error", message: e instanceof Error ? e.message : String(e) } } }),
    );
  }
  function openLibrary(source: SourceId, scrollTo?: "downloads"): void {
    setSheet({ kind: "library", source, scrollTo });
    loadLibrary(source);
  }
  let libSeq = 0;
  function searchLibrary(query: string): void {
    const sh = ui.sheet;
    if (sh?.kind !== "library") return;
    const seq = ++libSeq;
    if (!query) {
      setSheet({ ...sh, search: { query: "" } });
      return;
    }
    setSheet({ ...sh, search: { query, results: sh.search?.results } });
    later(searchDelay, () => {
      if (seq !== libSeq) return;
      listening.search(sh.source, query).then(
        (items) => {
          const cur = ui.sheet;
          if (seq === libSeq && cur?.kind === "library" && cur.search) setSheet({ ...cur, search: { query: cur.search.query, results: { status: "ready", items } } });
        },
        (e: unknown) => {
          const cur = ui.sheet;
          if (seq === libSeq && cur?.kind === "library" && cur.search)
            setSheet({ ...cur, search: { query: cur.search.query, results: { status: "error", message: e instanceof Error ? e.message : String(e) } } });
        },
      );
    });
  }
  function libraryItem(index: number): Item | undefined {
    const sh = ui.sheet;
    if (sh?.kind !== "library") return undefined;
    const f = sh.search ? sh.search.results : ui.library[sh.source];
    return f?.status === "ready" ? f.items[index] : undefined;
  }

  // ---- Actions -------------------------------------------------------------------------------------
  const onRoute = () => navState.kind === "guiding" || navState.kind === "rerouting";
  const focusField = (name: string) =>
    queueMicrotask(() => queueMicrotask(() => frame.querySelector<HTMLInputElement>(`[data-field="${name}"]`)?.focus()));

  const actions: Record<string, (arg: string | undefined) => void> = {
    "settings-open": () => setSheet({ kind: "settings" }),
    "sheet-close": () => {
      if (navState.kind === "preview") nav.cancelPreview();
      setSheet(undefined);
    },
    "sheet-back": () => setSheet({ kind: "settings" }),
    "where-open": () => {
      setSheet({ kind: "where", query: "" });
      focusField("where");
    },
    "place-pick": (arg) => {
      const place = placeAt(arg);
      if (!place) return;
      if (!ui.sheet) setSheet({ kind: "where", query: "" });
      fail(nav.preview(place));
    },
    "place-save": (arg) => {
      const place = placeAt(arg);
      const [list, index] = String(arg).split(":");
      if (!place || (list !== "results" && list !== "recent")) return;
      patchSheet("where", { saving: { list, index: Number(index), name: place.name }, savedIndex: undefined });
      focusField("save-name");
    },
    "save-cancel": () => patchSheet("where", { saving: undefined }),
    "save-confirm": () => {
      const sh = ui.sheet;
      if (sh?.kind !== "where" || !sh.saving) return;
      const place = placeAt(`${sh.saving.list}:${sh.saving.index}`);
      const name = sh.saving.name.trim() || place?.name || "";
      if (!place || !name) return;
      nav.savePlace(name, place);
      patchSheet("where", { saving: undefined, savedIndex: sh.saving.list === "results" ? sh.saving.index : undefined });
      toast(`Saved as ${name}`);
    },
    "preview-start": () => {
      nav.startPreview();
      setSheet(undefined);
    },
    "preview-back": () => nav.cancelPreview(),
    "route-retry": () => {
      if (memory.lastDestination) fail(nav.preview(memory.lastDestination));
    },
    "route-open": () => {
      if (onRoute()) setSheet({ kind: "route", edit: false, confirmEnd: false });
    },
    "route-edit": () => {
      const sh = ui.sheet;
      if (sh?.kind === "route") setSheet({ ...sh, edit: !sh.edit, confirmEnd: false });
    },
    "stop-remove": (arg) => fail(nav.removeStop(Number(arg))),
    "end-ask": () => patchSheet("route", { confirmEnd: true }),
    "end-keep": () => patchSheet("route", { confirmEnd: false }),
    "end-confirm": () => {
      nav.end();
      setSheet(undefined);
    },
    "add-stop-open": () => setSheet({ kind: "add-stop", query: "" }),
    "add-stop-back": () => setSheet({ kind: "route", edit: false, confirmEnd: false }),
    "stop-kind": (arg) => {
      setSheet({ kind: "add-stop", query: arg ?? "" });
      searchPlaces("add-stop", arg ?? "", 0);
    },
    "stop-add": (arg) => {
      const place = placeAt(arg);
      if (!place) return;
      fail(nav.addStop(place));
      setSheet({ kind: "route", edit: false, confirmEnd: false });
    },
    "arrived-done": () => nav.end(),
    "library-open": () => openLibrary(listening.nowPlaying?.item.source ?? "podcasts"),
    "lib-source": (arg) => openLibrary((arg as SourceId) ?? "podcasts"),
    "lib-search-back": () => {
      const sh = ui.sheet;
      if (sh?.kind === "library") setSheet({ kind: "library", source: sh.source });
    },
    "lib-play": (arg) => {
      const item = libraryItem(Number(arg));
      if (item) fail(listening.send({ type: "playItem", item }));
    },
    "key-back": () => fail(listening.send({ type: "back" })),
    "key-forward": () => fail(listening.send({ type: "forward" })),
    "key-toggle": () => fail(listening.send({ type: "toggle" })),
    "key-retry": () => fail(listening.send({ type: "play" })),
    "shelf-resume": (arg) => fail(listening.send({ type: "resume", source: arg as SourceId })),
    "shelf-open": (arg) => openLibrary(arg as SourceId),
    "codriver-open": () => setSheet({ kind: "co-driver" }),
    "codriver-choose": (arg) => {
      if (arg) coDriver.choose(arg);
    },
    "sound-mode-open": () => setSheet({ kind: "sound-mode" }),
    "sound-mode": (arg) =>
      settings.set({ soundMode: arg === "co-driver" ? { kind: "co-driver", coDriver: settings.value.coDriver } : { kind: "sounds" } }),
    "wake-toggle": () => {
      const on = !settings.value.wakeWord;
      settings.set({ wakeWord: on });
      wake.enable(on);
    },
    "test-sound": () => options.testTurnSound?.(),
    daylight: (arg) => {
      if (arg === "auto" || arg === "on" || arg === "off") settings.set({ daylight: arg });
    },
    "downloads-open": () => openLibrary("podcasts", "downloads"),
    "wifi-only": () => settings.set({ downloadsOnWifiOnly: !settings.value.downloadsOnWifiOnly }),
    "wifi-now": () => {
      downloads.setManualWifi(!downloads.status.manualWifi);
      fail(downloads.run());
    },
    "trips-open": () => setSheet({ kind: "trips" }),
    "trips-send": () => fail(deps.trips.flush()),
    "sounds-on": () => app.unblockSound(),
    update: () => app.applyUpdate(),
    // Settings: the version row. Ready: restart into it. Otherwise check now; a new version
    // reloads into it, nothing new shows "Up to date", and a failed check reloads anyway, so the
    // driver always has a way out of an old or broken version.
    "update-check": () => {
      if (app.updateReady) {
        app.applyUpdate();
        return;
      }
      if (ui.update === "checking") return;
      setUi({ update: "checking" });
      const done = (result: UpdateCheck) => {
        if (result === "current") {
          setUi({ update: "current" });
          later(TOAST_MS, () => {
            if (ui.update === "current") setUi({ update: undefined });
          });
          return;
        }
        setUi({ update: undefined });
        app.restart();
      };
      app.checkForUpdate().then(done, () => done("failed"));
    },
    "toast-dismiss": () => setUi({ toast: undefined }),
    "use-here": () => coDriver.choose(coDriver.current.id),
    "setup-location": () => (options.requestLocation ?? requestLocation)(),
    "setup-mic": () => (options.requestMic ?? requestMic)(),
    "setup-wake": () => {
      settings.set({ wakeWord: true });
      wake.enable(true);
    },
    "boot-retry": () => win.location.reload(),
  };

  function onClick(e: Event): void {
    const t = (e.target as Element | null)?.closest?.("[data-action], [data-talk]");
    if (!t || !frame.contains(t) || t.hasAttribute("data-talk")) return;
    if (t.matches(":disabled, [aria-disabled='true']")) return;
    const fn = actions[t.getAttribute("data-action") ?? ""];
    if (fn) {
      e.preventDefault();
      fn(t.getAttribute("data-arg") ?? undefined);
    }
  }

  // Talk: press and hold to speak; a tap (under 300 ms) stops the co-driver and sends nothing.
  let pressedAt: number | undefined;
  const talkDown = () => {
    if (pressedAt !== undefined) return;
    pressedAt = now();
    // A fault (no signal, unreachable, mic denied) shows its card for TOAST_MS after a press.
    memory.talkPressedAt = pressedAt;
    later(TOAST_MS + 50, schedule);
    coDriver.press();
    schedule();
  };
  const talkUp = (cancel = false) => {
    if (pressedAt === undefined) return;
    const held = now() - pressedAt;
    pressedAt = undefined;
    if (cancel || held < TAP_MS) coDriver.cancel();
    else coDriver.release();
  };
  function onPointerDown(e: PointerEvent): void {
    const t = (e.target as Element | null)?.closest?.("[data-talk]");
    if (!t) return;
    e.preventDefault();
    (t as HTMLElement).setPointerCapture?.(e.pointerId);
    talkDown();
  }
  const onPointerUp = () => talkUp();
  const onPointerCancel = () => talkUp(true);

  function onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest?.("[data-talk]") && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      if (!e.repeat) talkDown();
      return;
    }
    if (t.matches?.("[data-field]") && e.key === "Enter") {
      e.preventDefault();
      if (t.dataset.field === "save-name") actions["save-confirm"]?.(undefined);
      else {
        const v = (t as HTMLInputElement).value;
        if (t.dataset.field === "where" || t.dataset.field === "add-stop") searchPlaces(t.dataset.field, v, 0);
        t.blur();
      }
      return;
    }
    if (e.key === "Escape" && ui.sheet) {
      actions["sheet-close"]?.(undefined);
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && t.getAttribute("role") === "button" && t.dataset.action) {
      e.preventDefault();
      actions[t.dataset.action]?.(t.dataset.arg);
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if ((e.target as Element).closest?.("[data-talk]") && (e.key === " " || e.key === "Enter")) talkUp();
  }

  function onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    const name = t.dataset?.field;
    if (!name) return;
    const v = t.value;
    if (name === "where" || name === "add-stop") {
      if (name === "where") patchSheet("where", { query: v, saving: undefined, savedIndex: undefined, scrollTo: undefined });
      else patchSheet("add-stop", { query: v });
      searchPlaces(name, v);
    } else if (name === "save-name") {
      const sh = ui.sheet;
      if (sh?.kind === "where" && sh.saving) ui = { ...ui, sheet: { ...sh, saving: { ...sh.saving, name: v } } };
    } else if (name === "library") searchLibrary(v);
  }

  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  function onFocusIn(e: FocusEvent): void {
    if (!(e.target as Element).matches?.(".field-input")) return;
    if (blurTimer) clearTimeout(blurTimer);
    if (!ui.typing) setUi({ typing: true });
  }
  function onFocusOut(e: FocusEvent): void {
    if (!(e.target as Element).matches?.(".field-input")) return;
    // A tap on a result moves focus away first; wait a moment so the layout does not jump under it.
    blurTimer = later(120, () => {
      if (!(root.ownerDocument.activeElement as Element | null)?.matches?.(".field-input")) setUi({ typing: false });
    });
  }

  frame.addEventListener("click", onClick);
  frame.addEventListener("pointerdown", onPointerDown);
  frame.addEventListener("pointerup", onPointerUp);
  frame.addEventListener("pointercancel", onPointerCancel);
  frame.addEventListener("keydown", onKeyDown);
  frame.addEventListener("keyup", onKeyUp);
  frame.addEventListener("input", onInput);
  frame.addEventListener("focusin", onFocusIn);
  frame.addEventListener("focusout", onFocusOut);
  frame.addEventListener("contextmenu", (e) => {
    if ((e.target as Element).closest?.("[data-talk]")) e.preventDefault(); // a long press is Talk, not a menu
  });
  cleanups.push(() => {
    frame.removeEventListener("click", onClick);
    frame.removeEventListener("pointerdown", onPointerDown);
    frame.removeEventListener("pointerup", onPointerUp);
    frame.removeEventListener("pointercancel", onPointerCancel);
    frame.removeEventListener("keydown", onKeyDown);
    frame.removeEventListener("keyup", onKeyUp);
    frame.removeEventListener("input", onInput);
    frame.removeEventListener("focusin", onFocusIn);
    frame.removeEventListener("focusout", onFocusOut);
  });

  // ---- Subscriptions -----------------------------------------------------------------------------
  cleanups.push(
    nav.subscribe((state, r) => {
      remember(state, r);
      const left = (navState.kind === "guiding" || navState.kind === "rerouting") && !(state.kind === "guiding" || state.kind === "rerouting");
      navState = state;
      readouts = r;
      // A route sheet has nothing to show once the Route ends.
      if (left && (ui.sheet?.kind === "route" || ui.sheet?.kind === "add-stop")) ui = { ...ui, sheet: undefined };
      // Starting a route closes the Where to sheet.
      if ((state.kind === "guiding" || state.kind === "routing") && ui.sheet?.kind === "where") ui = { ...ui, sheet: undefined };
      schedule();
    }),
    listening.subscribe(() => schedule()),
    downloads.subscribe(() => schedule()),
    coDriver.subscribe(() => schedule()),
    wake.subscribe(() => schedule()),
    settings.subscribe(() => schedule()),
    app.subscribe(() => schedule()),
    online.subscribe(() => schedule()),
    deps.trips.subscribe(() => schedule()),
  );

  // The Fold changes size when it folds or rotates; the keyboard changes the visual viewport.
  const replan = () => schedule();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(replan);
    ro.observe(shell);
    cleanups.push(() => ro.disconnect());
  }
  win.addEventListener("resize", replan);
  win.visualViewport?.addEventListener("resize", replan);
  cleanups.push(() => {
    win.removeEventListener("resize", replan);
    win.visualViewport?.removeEventListener("resize", replan);
  });
  // Re-measure once Inter has loaded (the first layout can use the fallback face).
  // The one-off scrolls (Recent destinations, Downloads, an opened row) run again: the face changes heights.
  const fonts = root.ownerDocument.fonts;
  const refont = () => {
    scrolled = "";
    opened = "";
    schedule();
  };
  if (fonts) {
    fonts.ready.then(refont, () => undefined);
    fonts.addEventListener?.("loadingdone", refont);
    cleanups.push(() => fonts.removeEventListener?.("loadingdone", refont));
  }

  render();
  if (ui.typing) frame.querySelector<HTMLInputElement>("input[autofocus]")?.focus();

  return () => {
    disposed = true;
    for (const t of timers) clearTimeout(t);
    for (const c of cleanups) c();
    shell.remove();
  };
}

function requestLocation(): void {
  navigator.geolocation?.getCurrentPosition(
    () => undefined,
    () => undefined,
  );
}

function requestMic(): void {
  void navigator.mediaDevices
    ?.getUserMedia({ audio: true })
    .then((stream) => {
      for (const t of stream.getTracks()) t.stop();
    })
    .catch(() => undefined);
}

/**
 * Vela cannot start (no config): the answer only, no Talk. main.ts calls this. `retry` runs on
 * "Try again" (main.ts removes the service worker and the shell caches, then reloads); the
 * default is a plain reload.
 */
export function mountBootError(root: HTMLElement, message: string, options: { retry?: () => void } = {}): () => void {
  const shell = h("div", { class: "vela" });
  const frame = h("main", { class: "app", "aria-label": "Vela" });
  shell.append(frame);
  root.replaceChildren(shell);
  const w = shell.clientWidth || 932;
  const hgt = shell.clientHeight || 553;
  const p = plan(w, hgt);
  for (const [k, v] of Object.entries(planVars(p))) frame.style.setProperty(k, v);
  frame.dataset.flow = p.flow;
  frame.dataset.state = "boot-error";
  const s = bootScreen(message);
  frame.replaceChildren(...renderScreen(s, { keyboard: 0 }));
  let retrying = false;
  const onClick = (e: Event) => {
    if (!(e.target as Element).closest?.('[data-action="boot-retry"]') || retrying) return;
    retrying = true;
    (options.retry ?? (() => location.reload()))();
  };
  frame.addEventListener("click", onClick);
  return () => {
    frame.removeEventListener("click", onClick);
    shell.remove();
  };
}
