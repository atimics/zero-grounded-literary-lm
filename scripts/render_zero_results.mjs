import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(`zero report: ${message}`);
  process.exit(1);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function percent(value) {
  return `${(100 * value).toFixed(1)}%`;
}

function fixed(value) {
  return Number(value).toFixed(3);
}

function taskRows(mode) {
  const tasks = new Map();
  for (const item of mode.cases) {
    const task = tasks.get(item.task) || { cases: 0, wins: 0, margin: 0 };
    task.cases += 1;
    task.wins += item.win > 0 ? 1 : 0;
    task.margin += item.margin_bits;
    tasks.set(item.task, task);
  }
  return tasks;
}

function render(manifest, result) {
  const taskNames = [...new Set(result.modes.flatMap(mode => mode.cases.map(item => item.task)))];
  const lines = [
    "# ZERO channel baseline",
    "",
    `Frozen benchmark: \`${manifest.id}\` (${manifest.frozen}). Model: ${result.model.parameters.toLocaleString("en-US")} parameters, context ${result.model.context}, update ${result.model.update.toLocaleString("en-US")}.`,
    "",
    "A contrast win means the checkpoint assigned fewer teacher-forced bits per target byte to the coherent continuation than to its matched negative. Holo scores exercise the deterministic external recall index and its abstention threshold; they do not alter the transformer weights.",
    "",
    "| Runtime mode | Contrast wins | Win rate | Preferred bits/byte | Mean margin | Holo checks |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const mode of result.modes) {
    lines.push(`| ${mode.id} | ${mode.wins}/${mode.contrast_cases} | ${percent(mode.win_rate)} | ${fixed(mode.mean_positive_bits)} | ${fixed(mode.mean_margin_bits)} | ${mode.holo_cases ? `${mode.holo_hits}/${mode.holo_cases}` : "n/a"} |`);
  }

  lines.push("", "## Task-family wins", "");
  lines.push(`| Task | ${result.modes.map(mode => mode.id).join(" | ")} |`);
  lines.push(`| --- | ${result.modes.map(() => "---:").join(" | ")} |`);
  const taskMaps = result.modes.map(taskRows);
  for (const taskName of taskNames) {
    const values = taskMaps.map(tasks => {
      const task = tasks.get(taskName);
      return task ? `${task.wins}/${task.cases} (${fixed(task.margin)} total margin)` : "n/a";
    });
    lines.push(`| ${taskName} | ${values.join(" | ")} |`);
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    "The current quantized checkpoint clears most corpus-proxy dialogue contrasts, but this is not yet evidence of robust dialogue understanding. Transcript mode intentionally omits the six lossy-memory targets. Recurrent, flat, and partitioned modes share the same transformer context in this frozen pass, so their contrast scores match unless a recalled echo is injected. The separate Holo checks expose that distinction: flat recall passes more of this small suite than the first partitioned routing design.",
    "",
    "The benchmark is public and small. Use it to catch regressions and to compare the fixed four-way training ablation; retain a separate hidden, human-reviewed channel set for promotion decisions.",
    "",
    "## Integrity",
    "",
    `- Cases SHA-256: \`${manifest.cases.sha256}\``,
    `- Holo SHA-256: \`${manifest.holographic_cases.sha256}\``,
    `- Baseline model SHA-256: \`${manifest.baseline_model.sha256}\``,
    `- Result model FNV-1a-64: \`${result.model.fnv1a64}\``,
    "",
  );
  return `${lines.join("\n")}\n`;
}

const arguments_ = process.argv.slice(2);
const checking = arguments_[0] === "--check";
if (checking) arguments_.shift();
if (arguments_.length !== 3) {
  fail("usage: node scripts/render_zero_results.mjs [--check] MANIFEST RESULT OUTPUT");
}

const [manifestPath, resultPath, outputPath] = arguments_;
const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

for (const [label, artifact] of [
  ["cases", manifest.cases],
  ["Holo cases", manifest.holographic_cases],
  ["baseline model", manifest.baseline_model],
]) {
  const file = path.resolve(root, artifact.path);
  const actual = sha256(file);
  if (actual !== artifact.sha256) fail(`${label} SHA-256 mismatch: ${actual}`);
}
if (result.schema !== manifest.evaluator.result_schema) fail(`unexpected result schema ${result.schema}`);
if (result.benchmark_id !== manifest.id) fail(`unexpected benchmark ${result.benchmark_id}`);
if (result.model.parameters !== manifest.baseline_model.parameters ||
    result.model.context !== manifest.baseline_model.context ||
    result.model.update !== manifest.baseline_model.update) {
  fail("result model metadata does not match the frozen baseline");
}

const markdown = render(manifest, result);
if (checking) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== markdown) {
    fail(`${outputPath} is stale; run the report target`);
  }
  console.log(`verified ${manifest.id} artifacts and ${outputPath}`);
} else {
  fs.writeFileSync(outputPath, markdown);
  console.log(`verified artifacts and wrote ${outputPath}`);
}
