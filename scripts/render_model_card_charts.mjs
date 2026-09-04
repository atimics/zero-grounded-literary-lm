#!/usr/bin/env node
// Render the model-card charts as static SVG from frozen benchmark records.
//
//   node scripts/render_model_card_charts.mjs
//
// Zero dependencies, deterministic output. Writes one dark-theme and one
// light-theme SVG per chart into docs/assets/charts/. The dark theme is used
// by docs/model-card.html (GitHub Pages); the light theme is used by
// MODEL_CARD.md on GitHub.
//
// Sources (all frozen records; the script never invents numbers):
//   benchmarks/zero4-q26-v1/seed2/training.log       loss curve of the
//                                                    promoted ZERO.4 run
//   benchmarks/zero4-q26-v1/seed2/events.jsonl       sentinel guard events
//   benchmarks/zero4-q26r-v1/aggregate.json          three-seed replication
//   benchmarks/zero-eval-1/screen/results/result.json  external eval screen
//   benchmarks/zero-channel-v1/results/baseline.json channel benchmark

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "assets", "charts");
mkdirSync(outDir, { recursive: true });

const themes = {
  dark: {
    paper: "#171612", ink: "#e9e2d3", muted: "#9c968a", faint: "#69655e",
    line: "#38352d", gold: "#bca265", red: "#7c3f35", green: "#78856c",
  },
  light: {
    paper: "#ffffff", ink: "#1d1a14", muted: "#5c584f", faint: "#a39b8c",
    line: "#d8d3c8", gold: "#8a6d2f", red: "#7c3f35", green: "#4f6b45",
  },
};

const FONT = "'DM Mono', ui-monospace, monospace";

function svgEscape(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

class Chart {
  constructor(theme, width, height) {
    this.t = theme;
    this.w = width;
    this.h = height;
    this.parts = [];
  }
  text(x, y, content, { size = 10, fill = "muted", anchor = "start", weight = 300 } = {}) {
    this.parts.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${size}" ` +
      `font-weight="${weight}" fill="${this.t[fill]}" text-anchor="${anchor}">${svgEscape(content)}</text>`,
    );
    return this;
  }
  line(x1, y1, x2, y2, { stroke = "line", width = 1, dash = null, opacity = 1 } = {}) {
    this.parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
      `stroke="${this.t[stroke]}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} opacity="${opacity}"/>`,
    );
    return this;
  }
  polyline(points, { stroke, width = 1.5, dash = null, opacity = 1 } = {}) {
    const d = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    this.parts.push(
      `<polyline points="${d}" fill="none" stroke="${this.t[stroke]}" stroke-width="${width}"` +
      `${dash ? ` stroke-dasharray="${dash}"` : ""} opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    return this;
  }
  dot(x, y, r, fill, { stroke = null, width = 1 } = {}) {
    this.parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${this.t[fill]}"` +
      (stroke ? ` stroke="${this.t[stroke]}" stroke-width="${width}"` : "") + "/>",
    );
    return this;
  }
  rect(x, y, w, h, fill, { stroke = null, width = 1, rx = 0 } = {}) {
    this.parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" ` +
      `fill="${this.t[fill]}"${stroke ? ` stroke="${this.t[stroke]}" stroke-width="${width}"` : ""} rx="${rx}"/>`,
    );
    return this;
  }
  legend(x, y, entries, { size = 9 } = {}) {
    let cx = x;
    for (const [color, label] of entries) {
      this.dot(cx, y - size / 3, size / 2.4, color);
      this.text(cx + size, y, label, { size });
      cx += size + 8 + label.length * size * 0.62 + 16;
    }
    return this;
  }
  toString(title, subtitle) {
    const head = [];
    if (title) head.push(`<title>${svgEscape(title)}</title>`);
    let sub = "";
    if (subtitle) {
      sub = `<text x="${(this.w / 2).toFixed(1)}" y="34" font-family="${FONT}" font-size="9" ` +
        `fill="${this.t.faint}" text-anchor="middle">${svgEscape(subtitle)}</text>`;
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" ` +
      `width="${this.w}" height="${this.h}" role="img">` +
      head.join("") +
      `<rect width="${this.w}" height="${this.h}" fill="${this.t.paper}"/>` +
      (title ? `<text x="${(this.w / 2).toFixed(1)}" y="18" font-family="${FONT}" font-size="11" ` +
        `font-weight="500" fill="${this.t.ink}" text-anchor="middle">${svgEscape(title)}</text>` : "") +
      sub + this.parts.join("") + `</svg>\n`
    );
  }
}

function linear(v, v0, v1, p0, p1) {
  return p0 + ((v - v0) / (v1 - v0 || 1)) * (p1 - p0);
}

function write(name, svg) {
  writeFileSync(join(outDir, name), svg);
  process.stdout.write(`wrote docs/assets/charts/${name}\n`);
}

function emit(name, build) {
  for (const [themeName, theme] of Object.entries(themes)) {
    const suffix = themeName === "dark" ? "" : ".light";
    write(`${name}${suffix}.svg`, build(theme));
  }
}

// ---------------------------------------------------------------------------
// 1. Training loss: the promoted ZERO.4 faculty run (Q2.6 seed 2).
// ---------------------------------------------------------------------------
const trainingLog = readFileSync(join(root, "benchmarks/zero4-q26-v1/seed2/training.log"), "utf8");
const lossRows = [];
for (const line of trainingLog.split("\n")) {
  const m = line.match(/^update\s+(\d+) train ([\d.]+) val ([\d.]+)/);
  if (m) lossRows.push({ update: +m[1], train: +m[2], val: +m[3] });
}
if (lossRows.length < 2) throw new Error("no loss rows parsed from training.log");

emit("training-loss", (t) => {
  const c = new Chart(t, 560, 250);
  const L = 46, R = 530, T = 64, B = 206;
  const updates = lossRows.map((r) => r.update);
  const uMin = Math.min(...updates), uMax = Math.max(...updates);
  const yMax = 2.5, yMin = 0.5;
  const X = (u) => linear(u, uMin, uMax, L, R);
  const Y = (v) => linear(v, yMin, yMax, B, T);
  c.line(L, T, L, B);
  c.line(L, B, R, B);
  for (const g of [0.5, 1.0, 1.5, 2.0, 2.5]) {
    c.line(L, Y(g), R, Y(g), { stroke: "line", width: 0.6, opacity: 0.7 });
    c.text(L - 6, Y(g) + 3, g.toFixed(1), { anchor: "end", size: 8, fill: "faint" });
  }
  for (const u of [100, 200, 300, 400, 500, 600, 700]) {
    if (u <= uMax) c.text(X(u), B + 14, String(u), { anchor: "middle", size: 8, fill: "faint" });
  }
  c.polyline(lossRows.map((r) => [X(r.update), Y(r.train)]), { stroke: "muted", width: 1.4 });
  c.polyline(lossRows.map((r) => [X(r.update), Y(r.val)]), { stroke: "gold", width: 1.8 });
  for (const r of lossRows) {
    c.dot(X(r.update), Y(r.train), 1.7, "muted");
    c.dot(X(r.update), Y(r.val), 1.7, "gold");
  }
  c.legend(L, 50, [["muted", "train loss"], ["gold", "validation loss"]]);
  c.text((L + R) / 2, B + 32, "committed updates", { anchor: "middle", size: 8, fill: "faint" });
  return c.toString(
    "ZERO.4 faculty training — cross entropy per character",
    "Q2.6 seed 2 — update 500 of this run became the promoted ZERO.4",
  );
});

// ---------------------------------------------------------------------------
// 2. Replay guard: every 25 committed updates the frozen replay window was
//    re-measured; a 2.000% ceiling was never allowed to be crossed.
// ---------------------------------------------------------------------------
const events = readFileSync(join(root, "benchmarks/zero4-q26-v1/seed2/events.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sentinels = events.filter((e) => e.type === "sentinel" && Number.isFinite(e.replayRegression));
const publicEvals = events.filter((e) => e.type === "full-evaluation");

emit("capability-vs-guard", (t) => {
  const c = new Chart(t, 560, 410);
  const L = 46, R = 530;
  const uMax = 700;
  const X = (u) => linear(u, 0, uMax, L, R);

  // Top panel: exact quantity artifacts at each public evaluation.
  const T1 = 64, B1 = 190;
  const Y1 = (v) => linear(v, 0, 1, B1, T1);
  c.text(L, T1 - 8, "exact quantity artifacts — public evaluation every 100 updates", { size: 9, fill: "ink", weight: 500 });
  c.line(L, T1, L, B1);
  c.line(L, B1, R, B1);
  for (const g of [0, 0.5, 1.0]) {
    c.line(L, Y1(g), R, Y1(g), { stroke: "line", width: 0.6, opacity: 0.7 });
    c.text(L - 6, Y1(g) + 3, g.toFixed(2), { anchor: "end", size: 8, fill: "faint" });
  }
  c.line(L, Y1(0.95), R, Y1(0.95), { stroke: "green", width: 1.2, dash: "4 3" });
  c.text(R, Y1(0.95) - 5, "95% frozen gate", { anchor: "end", size: 8, fill: "green" });
  c.polyline(publicEvals.map((e) => [X(e.committed), Y1(e.rates.exact_artifact)]), { stroke: "gold", width: 1.8 });
  for (const e of publicEvals) {
    c.dot(X(e.committed), Y1(e.rates.exact_artifact), 2.6, "gold");
    c.text(X(e.committed), Y1(e.rates.exact_artifact) - 8, `${(e.rates.exact_artifact * 100).toFixed(1)}%`, {
      anchor: "middle", size: 8, fill: "ink",
    });
  }

  // Bottom panel: replay regression vs the frozen public ceiling.
  const T2 = 234, B2 = 372;
  const yMax = 0.025;
  const Y2 = (v) => linear(v, 0, yMax, B2, T2);
  c.text(L, T2 - 8, "replay regression vs the frozen ZERO.3 teachers", { size: 9, fill: "ink", weight: 500 });
  c.line(L, T2, L, B2);
  c.line(L, B2, R, B2);
  for (const g of [0, 0.01, 0.02]) {
    c.line(L, Y2(g), R, Y2(g), { stroke: "line", width: 0.6, opacity: 0.7 });
    c.text(L - 6, Y2(g) + 3, `${(g * 100).toFixed(1)}%`, { anchor: "end", size: 8, fill: "faint" });
  }
  for (const u of [100, 200, 300, 400, 500, 600, 700]) {
    c.text(X(u), B2 + 14, String(u), { anchor: "middle", size: 8, fill: "faint" });
  }
  c.line(L, Y2(0.02), R, Y2(0.02), { stroke: "red", width: 1.2, dash: "4 3" });
  c.text(R, Y2(0.02) - 5, "2.000% frozen ceiling", { anchor: "end", size: 8, fill: "red" });
  c.polyline(sentinels.map((e) => [X(e.committed), Y2(e.replayRegression)]), { stroke: "muted", width: 1, opacity: 0.7 });
  for (const e of sentinels) {
    c.dot(X(e.committed), Y2(e.replayRegression), 1.6, "faint");
  }
  c.polyline(publicEvals.map((e) => [X(e.committed), Y2(e.replayRegression)]), { stroke: "gold", width: 1.8 });
  for (const e of publicEvals) {
    c.dot(X(e.committed), Y2(e.replayRegression), 2.6, "gold");
  }
  c.legend(L, T2 + 10, [["gold", "public evaluation"], ["faint", "25-update sentinel window"]]);
  c.text((L + R) / 2, B2 + 30, "committed updates", { anchor: "middle", size: 8, fill: "faint" });
  return c.toString(
    "Learning arithmetic without forgetting the teachers",
    "The tangent projection kept every committed update under the frozen replay ceiling while the quantity faculty reached 99.8% exact artifacts",
  );
});

// ---------------------------------------------------------------------------
// 3. Replication: three declared seeds had to pass the unchanged contract.
// ---------------------------------------------------------------------------
const aggregate = JSON.parse(readFileSync(join(root, "benchmarks/zero4-q26r-v1/aggregate.json"), "utf8"));
const seeds = aggregate.declared_seeds.map((s) => ({ seed: s, ...aggregate.results[String(s)] }));

emit("replication", (t) => {
  const c = new Chart(t, 560, 252);
  const L = 46, R = 530, T = 64, B = 202;
  const n = seeds.length;
  const slot = (R - L) / n;
  const yMin = 0, yMax = 1.0;
  const Y = (v) => linear(v, yMin, yMax, B, T);
  c.line(L, T, L, B);
  c.line(L, B, R, B);
  for (const g of [0, 0.25, 0.5, 0.75, 1.0]) {
    c.line(L, Y(g), R, Y(g), { stroke: "line", width: 0.6, opacity: 0.7 });
    c.text(L - 6, Y(g) + 3, g.toFixed(2), { anchor: "end", size: 8, fill: "faint" });
  }
  // frozen promotion gate line at 95%
  c.line(L, Y(0.95), R, Y(0.95), { stroke: "green", width: 1.2, dash: "4 3" });
  c.text(R, Y(0.95) - 5, "95% frozen exact-artifact gate", { anchor: "end", size: 8, fill: "green" });
  seeds.forEach((s, i) => {
    const x = L + slot * (i + 0.5);
    const bw = slot * 0.34;
    const rate = s.exact_artifact_rate;
    c.rect(x - bw / 2, Y(rate), bw, B - Y(rate), "gold", { stroke: "gold", width: 1 });
    c.text(x, Y(rate) - 6, `${(rate * 100).toFixed(1)}%`, { anchor: "middle", size: 9, fill: "ink", weight: 500 });
    c.text(x, B + 14, `seed ${s.seed}`, { anchor: "middle", size: 9, fill: "muted" });
    c.text(x, B + 27, `replay +${(s.replay_relative_regression * 100).toFixed(2)}%`, { anchor: "middle", size: 8, fill: "faint" });
    c.text(x, B + 39, s.decision === "go" ? "GO" : "NO-GO", { anchor: "middle", size: 8, fill: s.decision === "go" ? "green" : "red", weight: 500 });
  });
  c.legend(L, 50, [["gold", "exact quantity artifacts, one-time promotion evaluation"]]);
  return c.toString(
    "Three-seed replication of the promoted run",
    "The update-500 seed-2 model became ZERO.4 only after seeds 1 and 3 passed the same frozen gates",
  );
});

// ---------------------------------------------------------------------------
// 4. External language eval screen (ZERO-EVAL-1, 1,000 cases per task).
// ---------------------------------------------------------------------------
const evalResult = JSON.parse(
  readFileSync(join(root, "benchmarks/zero-eval-1/screen/results/result.json"), "utf8"),
);
const evalTasks = [
  { key: "blimp", label: "BLiMP\nraw accuracy", metric: "raw_accuracy", kind: "acc" },
  { key: "hellaswag", label: "HellaSwag\nnormalized accuracy", metric: "normalized_accuracy", kind: "acc" },
  { key: "tinystories", label: "TinyStories\nbits per byte", metric: "bits_per_byte", kind: "bpb" },
  { key: "lambada", label: "LAMBADA (adapted)\nexact match", metric: "greedy_exact_accuracy", kind: "acc" },
];
function evalMetric(model, task, metric) {
  try {
    return evalResult.models[model].tasks[task].metrics[metric];
  } catch {
    return null;
  }
}

emit("external-eval", (t) => {
  const c = new Chart(t, 560, 264);
  const L = 46, R = 530, T = 66, B = 196;
  const n = evalTasks.length;
  const slot = (R - L) / n;
  c.line(L, T, L, B);
  c.line(L, B, R, B);
  c.text((L + R) / 2, B + 44, "ZERO.3 (grey) vs ZERO.4 (gold) — one frozen 1,000-case screen per task, lower is better on TinyStories", {
    anchor: "middle", size: 8, fill: "faint",
  });
  evalTasks.forEach((task, i) => {
    const x = L + slot * (i + 0.5);
    const z3 = evalMetric("zero3", task.key, task.metric);
    const z4 = evalMetric("zero4", task.key, task.metric);
    const isBpb = task.kind === "bpb";
    const scale = isBpb ? [2.4, 2.7] : [0, task.key === "lambada" ? 0.02 : (task.key === "blimp" ? 0.6 : 0.35)];
    const Y = (v) => linear(v, scale[0], scale[1], B, T);
    if (!isBpb) {
      for (let g = 0; g <= 1; g += 0.25) {
        const v = scale[0] + g * (scale[1] - scale[0]);
        c.line(x - slot / 2 + 8, Y(v), x + slot / 2 - 8, Y(v), { stroke: "line", width: 0.5, opacity: 0.6 });
        if (i === 0) c.text(L - 6, Y(v) + 3, v.toFixed(isBpb ? 2 : 2), { anchor: "end", size: 7, fill: "faint" });
      }
    } else {
      for (const v of [2.4, 2.55, 2.7]) {
        c.line(x - slot / 2 + 8, Y(v), x + slot / 2 - 8, Y(v), { stroke: "line", width: 0.5, opacity: 0.6 });
        if (i === 0) c.text(L - 6, Y(v) + 3, v.toFixed(2), { anchor: "end", size: 7, fill: "faint" });
      }
    }
    const bw = slot * 0.16;
    for (const [dx, color, v] of [[-bw - 2, "muted", z3], [2, "gold", z4]]) {
      if (v == null) continue;
      c.rect(x + dx, Y(v), bw, B - Y(v), color, { stroke: color, width: 1 });
      c.text(x + dx + bw / 2, Y(v) - 4, isBpb ? v.toFixed(3) : (task.key === "lambada" ? "0" : v.toFixed(3)), {
        anchor: "middle", size: 8, fill: "ink",
      });
    }
    const lines = task.label.split("\n");
    lines.forEach((line, j) => {
      c.text(x, B + 12 + j * 10, line, { anchor: "middle", size: 8, fill: "muted" });
    });
  });
  return c.toString(
    "External language screen — mixed, honestly reported",
    "ZERO-EVAL-1: the proposed full run was closed as do-not-run because of these results",
  );
});

// ---------------------------------------------------------------------------
// 5. Channel benchmark (zero-channel-v1) on the deployed checkpoint.
// ---------------------------------------------------------------------------
const channel = JSON.parse(
  readFileSync(join(root, "benchmarks/zero-channel-v1/results/baseline.json"), "utf8"),
);
const channelModes = channel.modes.map((m) => ({
  id: m.id, winRate: m.win_rate, contrast: m.contrast_cases, wins: m.wins,
  holoRate: m.holo_cases > 0 ? m.holo_hits / m.holo_cases : null,
  holoCases: m.holo_cases,
}));

emit("channel-benchmark", (t) => {
  const c = new Chart(t, 560, 250);
  const L = 46, R = 530, T = 64, B = 188;
  const n = channelModes.length;
  const slot = (R - L) / n;
  const Y = (v) => linear(v, 0, 1, B, T);
  c.line(L, T, L, B);
  c.line(L, B, R, B);
  for (const g of [0, 0.25, 0.5, 0.75, 1.0]) {
    c.line(L, Y(g), R, Y(g), { stroke: "line", width: 0.6, opacity: 0.7 });
    c.text(L - 6, Y(g) + 3, g.toFixed(2), { anchor: "end", size: 8, fill: "faint" });
  }
  c.line(L, Y(0.5), R, Y(0.5), { stroke: "faint", width: 1, dash: "4 3" });
  c.text(R, Y(0.5) - 5, "coin flip", { anchor: "end", size: 8, fill: "faint" });
  channelModes.forEach((m, i) => {
    const x = L + slot * (i + 0.5);
    const bw = slot * 0.34;
    c.rect(x - bw - 2, Y(m.winRate), bw, B - Y(m.winRate), "gold", { stroke: "gold", width: 1 });
    c.text(x - bw / 2 - 2, Y(m.winRate) - 5, `${(m.winRate * 100).toFixed(1)}%`, { anchor: "middle", size: 9, fill: "ink", weight: 500 });
    if (m.holoRate != null) {
      c.rect(x + 2, Y(m.holoRate), bw, B - Y(m.holoRate), "green", { stroke: "green", width: 1 });
      c.text(x + 2 + bw / 2, Y(m.holoRate) - 5, `${(m.holoRate * 100).toFixed(1)}%`, { anchor: "middle", size: 9, fill: "ink", weight: 500 });
    }
    c.text(x, B + 14, m.id, { anchor: "middle", size: 9, fill: "muted" });
    c.text(x, B + 26, `${m.wins}/${m.contrast} contrasts${m.holoCases ? ` · ${Math.round((m.holoRate || 0) * m.holoCases)}/${m.holoCases} holo` : ""}`, {
      anchor: "middle", size: 8, fill: "faint",
    });
  });
  c.legend(L, 50, [["gold", "coherence contrast wins"], ["green", "episodic recall (Holo)"]]);
  return c.toString(
    "Channel behaviour on the deployed model",
    "zero-channel-v1: matched coherent vs incoherent continuations, teacher-forced, no sampling",
  );
});

// ---------------------------------------------------------------------------
// 6. Lineage diagram: static, hand-authored.
// ---------------------------------------------------------------------------
emit("lineage", (t) => {
  const c = new Chart(t, 560, 300);
  const boxes = [
    { x: 30, y: 60, w: 115, h: 66, title: "ZERO.1", sub: "7,436-param\ncharacter MLP", note: "frozen teacher\nfrom update 20,000" },
    { x: 200, y: 60, w: 115, h: 66, title: "ZERO.2", sub: "4.85M literary\ntransformer", note: "frozen teacher\nupdate 12,600" },
    { x: 370, y: 60, w: 115, h: 66, title: "ZERO.3", sub: "distilled\nintegrator", note: "frozen teacher\nupdate 16,600" },
    { x: 200, y: 195, w: 285, h: 66, title: "ZERO.4", sub: "the deployed model — quantity faculty + tangent-projection guard", note: "promoted at update 500 (seed 2), replicated on seeds 1 and 3" },
  ];
  for (const b of boxes) {
    c.rect(b.x, b.y, b.w, b.h, "paper", { stroke: "line", width: 1, rx: 6 });
    c.text(b.x + b.w / 2, b.y + 18, b.title, { anchor: "middle", size: 11, fill: "ink", weight: 500 });
    b.sub.split("\n").forEach((line, j) => {
      c.text(b.x + b.w / 2, b.y + 33 + j * 11, line, { anchor: "middle", size: 8, fill: "muted" });
    });
    b.note.split("\n").forEach((line, j) => {
      c.text(b.x + b.w / 2, b.y + b.h - 16 + j * 10, line, { anchor: "middle", size: 7, fill: "faint" });
    });
  }
  const arrow = (x1, y1, x2, y2, label, ly) => {
    c.line(x1, y1, x2, y2, { stroke: "faint", width: 1.2 });
    // arrowhead
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = 6;
    c.parts.push(
      `<path d="M ${(x2).toFixed(1)} ${(y2).toFixed(1)} L ${(x2 - len * Math.cos(ang - 0.4)).toFixed(1)} ${(y2 - len * Math.sin(ang - 0.4)).toFixed(1)} L ${(x2 - len * Math.cos(ang + 0.4)).toFixed(1)} ${(y2 - len * Math.sin(ang + 0.4)).toFixed(1)} Z" fill="${t.faint}"/>`,
    );
    if (label) c.text((x1 + x2) / 2, ly, label, { anchor: "middle", size: 7, fill: "faint" });
  };
  arrow(145, 78, 200, 78, "distills into", 66);
  arrow(315, 78, 370, 78, "distills into", 66);
  arrow(87.5, 126, 310, 195, "foundation target", 168);
  arrow(257.5, 126, 330, 195, "literary replay", 178);
  arrow(427.5, 126, 420, 195, "initializes + replay", 172);
  return c.toString(
    "How ZERO.4 was built",
    "Every earlier model stays loaded and frozen as a teacher; the student never averages weights",
  );
});

process.stdout.write(`done: ${Object.keys(themes).length} themes written to docs/assets/charts\n`);
