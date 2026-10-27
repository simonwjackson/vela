/**
 * dev-moments.html: the real app mount on fakes, with a stand-in SurfaceLink (FakeMoments) that
 * sends a Moment and records what Vela reports. Step it through every phase by hand, or open it at
 * one phase for captures:
 *
 *   ?scene=fuel|arrived|stops|engine|refused   the Moment and its situation (dev/moments.ts)
 *   &phase=idle|waiting|screen|details|faded|settings|car|car-end   (refused: the scene's show is refused)
 *   &posture=um|ul|up|fl|fp   the frame's size beside the controls (core/postures.ts); &bare=1 fills the window
 *   &stress=1&daylight=1   worst-case data, Daylight contrast
 *   &car=reconnecting|connect   the car link mid-recovery, or needing a tap
 *
 * Sets body[data-ready] once the phase is drawn and fonts and covers have loaded.
 */
import { mount } from "../app/mount";
import { POSTURES, posture as postureOf } from "../core/postures";
import { fakes } from "./fakes";
import { NOW } from "./fixtures";
import { MOMENT_SCENES, momentScene, passTurn, setUp } from "./moments";

const q = new URLSearchParams(location.search);
const flag = (k: string) => q.has(k) && q.get(k) !== "0";
const root = document.getElementById("app") as HTMLElement;
const sc = momentScene(q.get("scene") ?? "fuel") ?? MOMENT_SCENES[0];
const stress = flag("stress");
const daylight = flag("daylight");
const bare = flag("bare");
const phase = q.get("phase") ?? "idle";
const posture = postureOf(q.get("posture")) ?? POSTURES[0];
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

async function run(): Promise<void> {
  if (!sc) return;
  document.body.classList.add(bare ? "md-bare" : "md-dev");
  const f = fakes();
  const setup = setUp(sc, f, stress);
  f.nav.readouts = { ...f.nav.readouts, daylight };
  // &car=reconnecting|connect: the car link mid-recovery, or needing a tap.
  if (q.get("car") === "reconnecting") f.car.set({ kind: "reconnecting", attempt: 2, retryAt: NOW + 5_000 }, {});
  if (q.get("car") === "connect") f.car.set({ kind: "connect", reason: "permission" }, {});
  const show = sc.show(stress);

  const frameBox = el("div", { class: "md-framebox" });
  const phaseText = el("div", { class: "md-phase", role: "status" });
  const log = el("pre", { class: "md-code", "aria-label": "Reported to the assistant" });
  const life = el("div", { class: "md-life" });
  if (bare) root.append(frameBox);
  else {
    const pick = (label: string, value: string, options: [string, string][], key: string) => {
      const s = el("select", { "aria-label": label });
      for (const [v, t] of options) s.append(el("option", { value: v }, t));
      s.value = value;
      s.addEventListener("change", () => {
        const u = new URL(location.href);
        u.searchParams.set(key, s.value);
        u.searchParams.delete("phase");
        location.href = u.href;
      });
      return el("label", {}, `${label} `, s);
    };
    const toggle = (label: string, key: string, on: boolean) => {
      const b = el("input", { type: "checkbox" });
      b.checked = on;
      b.addEventListener("change", () => {
        const u = new URL(location.href);
        if (b.checked) u.searchParams.set(key, "1");
        else u.searchParams.delete(key);
        location.href = u.href;
      });
      return el("label", {}, b, ` ${label}`);
    };
    const stage = el("div", { class: "md-stage" }, frameBox);
    root.append(
      el(
        "header",
        { class: "md-chrome" },
        pick("Moment", sc.id, MOMENT_SCENES.map((s) => [s.id, s.label]), "scene"),
        pick("Posture", posture.id, POSTURES.map((p) => [p.id, `${p.w}×${p.h} ${p.label.toLowerCase()}`]), "posture"),
        toggle("Worst case", "stress", stress),
        toggle("Daylight", "daylight", daylight),
      ),
      el("div", { class: "md-main" }, stage, el("aside", { class: "md-side" }, el("p", { class: "md-say" }, `“${show.say}”`), phaseText, life, el("pre", { class: "md-code", "aria-label": "Program" }, show.program), log)),
    );
    // A posture larger than the stage is drawn at its size, then scaled to fit.
    const size = () => {
      const scale = Math.min(1, stage.clientWidth / posture.w);
      frameBox.style.cssText = `width:${posture.w}px;height:${posture.h}px;${scale < 1 ? `transform:scale(${scale})` : ""}`;
      stage.style.height = `${Math.ceil(posture.h * scale)}px`;
    };
    size();
    addEventListener("resize", size);
  }

  const start = Date.now();
  let current = "none";
  const report = () => {
    phaseText.textContent = `Phase: ${current}. ${current === "waiting" ? "A turn under 1 km is ahead: the chip shows, the Moment comes after it." : ""}`;
    log.textContent = f.moments.sent.length ? f.moments.sent.map((s) => JSON.stringify(s)).join("\n") : "Nothing reported yet.";
  };
  mount(frameBox, f, {
    now: () => NOW + (Date.now() - start),
    dev: true,
    ...(setup.initial ? { initial: setup.initial } : {}),
    ...(setup.memory ? { memory: setup.memory } : {}),
    online: { get: () => setup.online ?? true, subscribe: () => () => undefined },
    onMoment: (p) => {
      current = p;
      report();
    },
  });
  // The stand-in SurfaceLink's controls: what the assistant sends, and what happens on the road.
  const button = (label: string, fn: () => void | Promise<void>) => {
    const b = el("button", { type: "button" }, label);
    b.addEventListener("click", () => {
      void Promise.resolve(fn()).then(async () => {
        await settle(60);
        report();
      });
    });
    return b;
  };
  life.append(
    button("Send moment.show", () => f.moments.show(sc.show(stress))),
    button("Pass the turn", () => passTurn(f)),
    button(`Fire ${"event" in show.until ? show.until.event : "until"}`, () => {
      // The until event, as Vela would see it on the road.
      if (!("event" in show.until)) return;
      const ev = show.until.event;
      const st = f.nav.state;
      if (ev === "stop.added" && (st.kind === "guiding" || st.kind === "rerouting")) {
        const g = st.guidance;
        f.nav.set({ ...st, guidance: { ...g, route: { ...g.route, via: [...g.route.via, { name: "Harbour Fuel", lat: 0.9, lng: -0.9 }] } } });
      } else if (ev === "stop.reached" && (st.kind === "guiding" || st.kind === "rerouting")) {
        const g = st.guidance;
        f.nav.set({ ...st, guidance: { ...g, route: { ...g.route, via: g.route.via.slice(1) } } });
      }
    }),
    button("Say “never mind”", () => f.coDriver.set({ kind: "thinking", said: "Never mind" })),
    button("Assistant: moment.dismiss", () => f.moments.clear()),
  );
  report();
  await settle();

  // A phase for captures.
  const tap = async (sel: string) => {
    frameBox.querySelector<HTMLElement>(sel)?.click();
    await settle(80);
  };
  const shown = async () => {
    f.moments.show(show);
    for (let i = 0; i < 100 && f.moments.sent.length === 0; i++) await settle(20);
    await settle(60);
  };
  if (phase === "waiting") await shown();
  if (phase === "screen" || phase === "details" || phase === "faded") {
    await shown();
    if (current === "waiting") {
      passTurn(f);
      await settle(80);
    }
    if (phase === "details") await tap('[data-action="moment-details"]');
    if (phase === "faded") await tap('[data-action="moment-close"]');
  }
  if (phase === "settings" || phase === "car" || phase === "car-end") await tap('[data-action="settings-open"]');
  // The car rows sit at the end of the Settings list: scroll them into view.
  if (phase === "car") {
    const list = frameBox.querySelector<HTMLElement>(".sheet .list");
    const car = frameBox.querySelector<HTMLElement>(".talk-car");
    if (list && car) list.scrollTop += car.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
    await settle(80);
  }
  if (phase === "car-end") {
    const list = frameBox.querySelector<HTMLElement>(".sheet .list");
    if (list) list.scrollTop = list.scrollHeight;
    await settle(80);
  }
  report();
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? undefined : new Promise((r) => { img.onload = img.onerror = r; }))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.body.dataset.phase = current;
  document.body.dataset.ready = "1";
}

void run();
