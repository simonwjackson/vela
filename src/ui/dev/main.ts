/**
 * The dev page: `dev.html?state=<id>&stress=1&daylight=1` mounts the real app on fakes in any of
 * the Signal states. `&update=ready|checking|current` sets the update state (Settings shows it in
 * its version row), and `&check=current|updated|failed` is what a tap on that row finds, after
 * 1.2 s. `&version=` sets the build shown there. Without `state` it lists them. Arrow keys step through states; S and D flip
 * stress and Daylight. Sets body[data-ready] when fonts and covers have loaded, and
 * body[data-mapped] to the state the app's mapping chose.
 */
import { mount, mountBootError } from "../app/mount";
import type { UiState } from "../app/screen";
import { fakes } from "./fakes";
import { NOW, fixtures } from "./fixtures";
import { SCENARIOS, scenario } from "./scenarios";

const q = new URLSearchParams(location.search);
const flag = (k: string) => q.has(k) && q.get(k) !== "0";
const root = document.getElementById("app") as HTMLElement;
const id = q.get("state");
const stress = flag("stress");
const daylight = flag("daylight");

function go(patch: { state?: string; stress?: boolean; daylight?: boolean }): void {
  const url = new URL(location.href);
  if (patch.state) url.searchParams.set("state", patch.state);
  for (const k of ["stress", "daylight"] as const) {
    const v = patch[k] ?? flag(k);
    if (v) url.searchParams.set(k, "1");
    else url.searchParams.delete(k);
  }
  location.href = url.href;
}

async function ready(): Promise<void> {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? undefined : new Promise((r) => { img.onload = img.onerror = r; }))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.body.dataset.ready = "1";
}

const sc = id ? scenario(id) : undefined;
if (!sc) {
  document.body.classList.add("dev-index");
  const list = document.createElement("ol");
  for (const s of SCENARIOS) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `?state=${s.id}`;
    a.textContent = `${s.area} / ${s.label} (${s.id})`;
    li.append(a);
    list.append(li);
  }
  root.append(list);
  document.body.dataset.ready = "1";
} else {
  const f = fakes();
  const x = fixtures(stress);
  const setup = sc.setup(f, x, stress) ?? {};
  // ?talk=offline|unreachable|mic-denied: Talk at rest in a fault state, over any state (review round 1).
  const talk = q.get("talk");
  if (talk === "offline" || talk === "mic-denied") f.coDriver.state = { kind: talk };
  if (talk === "unreachable") f.coDriver.state = { kind: "unreachable", reason: "error" };
  const update = q.get("update");
  if (update === "ready") f.app.updateReady = true;
  const check = q.get("check");
  f.app.checkResult = check === "updated" || check === "failed" ? check : "current";
  f.app.checkMs = 1_200;
  const initial: Partial<UiState> = { ...setup.initial, ...(update === "checking" || update === "current" ? { update } : {}) };
  f.nav.readouts = { ...f.nav.readouts, daylight };
  if (setup.boot !== undefined) {
    mountBootError(root, setup.boot);
    if (daylight) root.querySelector(".vela")?.setAttribute("data-daylight", "");
    document.body.dataset.mapped = "boot-error";
  } else {
    const online = setup.online ?? true;
    mount(root, f, {
      // A short git revision, as the Nix build stamps it; worst case, a build from a dirty tree.
      version: q.get("version") ?? (stress ? "1a2b3c4-dirty" : "1a2b3c4"),
      now: () => NOW,
      dev: true,
      initial,
      ...(setup.memory ? { memory: setup.memory } : {}),
      online: { get: () => online, subscribe: () => () => undefined },
      // The OS keyboard, modelled as the mockup does: 40% of the screen in col flow, 50% in row flow.
      keyboard: () => {
        if (!setup.keyboard) return 0;
        const w = innerWidth;
        const h = innerHeight;
        return Math.round(h * (w / h >= 1.2 ? 0.5 : 0.4));
      },
      onScreen: (s) => {
        document.body.dataset.mapped = s.id;
      },
    });
  }
  document.body.dataset.expect = sc.expect ?? sc.id;
  addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.target as Element).matches?.("input")) return;
    const i = SCENARIOS.indexOf(sc);
    if (e.key === "ArrowRight") go({ state: SCENARIOS[(i + 1) % SCENARIOS.length]?.id ?? sc.id });
    else if (e.key === "ArrowLeft") go({ state: SCENARIOS[(i - 1 + SCENARIOS.length) % SCENARIOS.length]?.id ?? sc.id });
    else if (e.key === "s") go({ stress: !stress });
    else if (e.key === "d") go({ daylight: !daylight });
  });
}
void ready();
