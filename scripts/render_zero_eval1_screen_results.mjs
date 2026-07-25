#!/usr/bin/env node

import fs from "node:fs";

const [resultPath, outputPath] = process.argv.slice(2);
if (!resultPath || !outputPath) {
  throw new Error("usage: render_zero_eval1_screen_results.mjs RESULT OUTPUT");
}
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const labels = {
  blimp: "BLiMP",
  tinystories: "TinyStories",
  hellaswag: "HellaSwag",
  lambada: "LAMBADA (adapted)",
};
const format = (value) => Number(value).toFixed(6);
const lines = [
  "# ZERO-EVAL-1 stratified screen results",
  "",
  `Source commit: \`${result.git_commit}\``,
  "",
  "| Task | Metric | ZERO.3 | ZERO.4 | Δ ZERO.4−ZERO.3 |",
  "|---|---:|---:|---:|---:|",
];
for (const [task, item] of Object.entries(result.comparisons)) {
  lines.push(
    `| ${labels[task]} | ${item.primary_metric} | ${format(item.zero3)} | ` +
    `${format(item.zero4)} | ${format(item.zero4_minus_zero3)} |`,
  );
}
lines.push(
  "",
  `AWS launch-relative time: ${result.elapsed_instance_seconds} seconds; ` +
    `estimated compute: $${result.estimated_compute_usd.toFixed(4)}.`,
  "",
  "These are one-pass results on the exact frozen 1,000-case stratified samples. " +
    "They do not represent the unexecuted full suite. LAMBADA uses the preregistered " +
    "511-character context adaptation. BLiMP per-paradigm values are descriptive only.",
  "",
);
fs.writeFileSync(outputPath, lines.join("\n"));
