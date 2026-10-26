#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium --command node
// The co-driver composes novel Signal screens: tools/openui-compose.mjs [--only a,b,c,d] [--mutation] [--dry]
//
// The system prompt comes from the vocabulary (src/ui/openui/prompt.ts: generateSystemPrompt with
// the Signal brief's rules and the five approved programs as examples). Each context goes to an
// OpenAI-compatible chat endpoint; the program goes through the gate (src/ui/openui/gate.ts, run in
// headless Chromium so the render probe measures real layout); problems go back to the model once.
// The final programs are saved as fixtures in src/ui/openui/programs/, with compose-log.json.
//
// The endpoint comes from the environment only; nothing about it is written anywhere:
//   OPENUI_SPIKE_BASE_URL       the API base, ending in /v1
//   OPENUI_SPIKE_KEY_FILE       a JSON file holding the key (apiKey, api_key or key)
//   OPENUI_SPIKE_MODEL          the model
//   OPENUI_SPIKE_FALLBACK_MODEL optional: used when a call with the model fails
// --dry prints the system prompt and the contexts, and calls nothing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { browser, devServer, repo } from "./lib/browser.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const dry = argv.includes("--dry");
const CASES = [
  { id: "novel-a", scene: "rain", letter: "a" },
  { id: "novel-b", scene: "episode", letter: "b" },
  { id: "novel-c", scene: "fuel", letter: "c" },
  { id: "novel-d", scene: "parked", letter: "d" },
];
const only = opt("only")?.split(",");
const cases = CASES.filter((c) => !only || only.includes(c.letter));
const programs = join(repo, "src/ui/openui/programs");
const captures = join(repo, "captures");
mkdirSync(captures, { recursive: true });

const env = (k) => {
  const v = process.env[k];
  if (!v && !dry) throw new Error(`Set ${k}`);
  return v;
};
const base = env("OPENUI_SPIKE_BASE_URL")?.replace(/\/$/, "");
const keyFile = env("OPENUI_SPIKE_KEY_FILE");
let model = env("OPENUI_SPIKE_MODEL");
const fallback = process.env.OPENUI_SPIKE_FALLBACK_MODEL;
const key = (() => {
  if (dry) return "";
  const j = JSON.parse(readFileSync(keyFile, "utf8"));
  const k = j.apiKey ?? j.api_key ?? j.key;
  if (!k) throw new Error("The key file has no apiKey, api_key or key");
  return k;
})();

async function chat(messages) {
  const call = async (m) => {
    const t0 = performance.now();
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: m, messages, max_tokens: 2000 }),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error(`${m}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return { text: j.choices?.[0]?.message?.content ?? "", ms, model: m, usage: j.usage };
  };
  try {
    return await call(model);
  } catch (e) {
    if (!fallback || fallback === model) throw e;
    console.error(`${String(e.message)}; trying ${fallback}`);
    model = fallback;
    return await call(model);
  }
}

/** The program out of a reply: no fences, no prose before the first statement. */
function programOf(text, full = true) {
  let t = text.replace(/```[a-z-]*\n?/g, "").replace(/```/g, "").trim();
  if (full) {
    const i = t.search(/^root\s*=/m);
    if (i > 0) t = t.slice(i);
  }
  return `${t.trim()}\n`;
}

const server = await devServer();
const page = await browser();
const log = [];
try {
  await page.open(`${server.origin}/openui.html?api=1`);
  await page.waitFor("window.oui");
  const system = await page.evaluate("window.oui.systemPrompt()");
  writeFileSync(join(captures, "system-prompt.txt"), system);
  console.log(`system prompt: ${system.length} characters (captures/system-prompt.txt)`);
  for (const c of cases) {
    const context = await page.evaluate(`window.oui.context(${JSON.stringify(c.scene)})`);
    if (dry) {
      console.log(`--- ${c.id} (${c.scene})\n${context}`);
      continue;
    }
    const messages = [
      { role: "system", content: system },
      { role: "user", content: `Compose the screen for this moment.\n\n${context}` },
    ];
    const attempts = [];
    for (let round = 0; round < 2; round++) {
      const r = await chat(messages);
      const program = programOf(r.text);
      const v = await page.evaluate(`window.oui.gate(${JSON.stringify(program)}, ${JSON.stringify(c.scene)})`);
      attempts.push({ model: r.model, ms: r.ms, usage: r.usage, program, ok: v.ok, problems: v.problems });
      console.log(`${c.id} round ${round + 1}: ${r.model} ${r.ms} ms, gate ${v.ok ? "passed" : `refused (${v.problems.length})`}`);
      if (!v.ok) console.log(`  ${v.problems.map((p) => `[${p.code}] ${p.message}`).join("\n  ")}`);
      if (v.ok) break;
      // Feed the problems back once.
      messages.push({ role: "assistant", content: program }, { role: "user", content: v.text });
    }
    const last = attempts[attempts.length - 1];
    writeFileSync(join(programs, `${c.id}.oui`), last.program);
    log.push({ id: c.id, scene: c.scene, context: JSON.parse(context), attempts });
  }

  if (argv.includes("--mutation") && !dry) {
    // The mutation: one part of screen (a) changes, as a lang-core edit-mode patch (mergeStatements).
    const before = readFileSync(join(programs, "novel-a.oui"), "utf8");
    const edit = await page.evaluate("window.oui.editPrompt()");
    const context = await page.evaluate(`window.oui.context("rain")`);
    const event = "The driver tapped away your rain note: they have seen it. Give that part of the screen back to what plays, and change nothing else.";
    const messages = [
      { role: "system", content: edit },
      { role: "user", content: `The screen now:\n\n${before}\nWhat happened: ${event}\n\n${context}` },
    ];
    const attempts = [];
    let after = before;
    for (let round = 0; round < 2; round++) {
      const r = await chat(messages);
      const patch = programOf(r.text, false);
      after = await page.evaluate(`window.oui.patch(${JSON.stringify(before)}, ${JSON.stringify(patch)})`);
      after = `${after.trim()}\n`;
      const v = await page.evaluate(`window.oui.gate(${JSON.stringify(after)}, "rain")`);
      attempts.push({ model: r.model, ms: r.ms, usage: r.usage, patch, merged: after, ok: v.ok, problems: v.problems });
      console.log(`mutation round ${round + 1}: ${r.model} ${r.ms} ms, ${patch.trim().split("\n").length} statements, gate ${v.ok ? "passed" : `refused (${v.problems.length})`}`);
      if (!v.ok) console.log(`  ${v.problems.map((p) => `[${p.code}] ${p.message}`).join("\n  ")}`);
      writeFileSync(join(programs, "novel-a-patch.oui"), patch);
      if (v.ok) break;
      messages.push({ role: "assistant", content: patch }, { role: "user", content: `${v.text}\nSend only the statements that change.` });
    }
    writeFileSync(join(programs, "novel-a-after.oui"), after);
    log.push({ id: "novel-a-after", scene: "rain", event, attempts });
  }
} finally {
  page.close();
  await server.close();
}
if (!dry) {
  // Merge with an earlier log, so a rerun of one case keeps the others.
  let old = [];
  try {
    old = JSON.parse(readFileSync(join(programs, "compose-log.json"), "utf8"));
  } catch {}
  const ids = new Set(log.map((l) => l.id));
  writeFileSync(join(programs, "compose-log.json"), `${JSON.stringify([...old.filter((l) => !ids.has(l.id)), ...log], null, 2)}\n`);
}
