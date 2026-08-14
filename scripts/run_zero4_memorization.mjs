import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const options = {
    out: "release/zero4-memorization-v1.json",
    evaluatedAt: "2026-08-12",
    samples: 16,
    prompt: 128,
    continuation: 64,
    warningPrefix: 32,
    blockPrefix: 64,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`missing value for ${key}`);
    if (key === "--out") options.out = value;
    else if (key === "--evaluated-at") options.evaluatedAt = value;
    else if (key === "--samples") options.samples = Number(value);
    else if (key === "--prompt") options.prompt = Number(value);
    else if (key === "--continuation") options.continuation = Number(value);
    else if (key === "--warning-prefix") options.warningPrefix = Number(value);
    else if (key === "--block-prefix") options.blockPrefix = Number(value);
    else throw new Error(`unknown option: ${key}`);
    index += 1;
  }
  for (const key of ["samples", "prompt", "continuation", "warningPrefix", "blockPrefix"]) {
    assert(Number.isInteger(options[key]) && options[key] > 0, `${key} must be a positive integer`);
  }
  assert(/^\d{4}-\d{2}-\d{2}$/.test(options.evaluatedAt), "--evaluated-at must be YYYY-MM-DD");
  return options;
}

const options = parseArgs(process.argv);
const deployment = readJson("docs/model.json");
const contract = readJson("benchmarks/zero4-q26-v1/contract.json");
const modelPath = "docs/model.litq8";
const expectedModelSha = deployment.artifact.sha256;
const sources = [
  ["zero-foundation", "corpus/bpe/zero-foundation.tok", contract.replay_corpus["corpus/bpe/zero-foundation.tok"], false],
  ["shakespeare", "corpus/bpe/shakespeare.tok", contract.replay_corpus["corpus/bpe/shakespeare.tok"], true],
  ["blake", "corpus/bpe/blake.tok", contract.replay_corpus["corpus/bpe/blake.tok"], true],
  ["crowley", "corpus/bpe/crowley.tok", contract.replay_corpus["corpus/bpe/crowley.tok"], true],
  ["bible-kjv", "corpus/bpe/bible-kjv.tok", contract.replay_corpus["corpus/bpe/bible-kjv.tok"], true],
  ["literary-channel", "corpus/channel/literary-dialogue.tok", contract.replay_corpus["corpus/channel/literary-dialogue.tok"], true],
  ["quantity-requests", "corpus/faculty/q22/quantity-request.tok", contract.quantity_corpus.tokens_sha256, false],
];

assert.equal(sha256(modelPath), expectedModelSha, "deployed model hash drifted");
for (const [id, file, expected] of sources) {
  assert(typeof expected === "string", `no contract hash for ${id}`);
  assert(fs.existsSync(file), `missing reconstructed source: ${file}`);
  assert.equal(sha256(file), expected, `training artifact hash drifted: ${id}`);
}

const evaluatorArgs = [modelPath];
for (const [id, file, , blocking] of sources) evaluatorArgs.push(blocking ? "--source" : "--informational-source", id, file);
evaluatorArgs.push(
  "--samples", String(options.samples),
  "--prompt", String(options.prompt),
  "--continuation", String(options.continuation),
  "--warning-prefix", String(options.warningPrefix),
  "--block-prefix", String(options.blockPrefix),
);
const run = spawnSync("./memorization_eval", evaluatorArgs, {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
if (run.error) throw run.error;
if (run.status !== 0 && run.status !== 2) {
  process.stderr.write(run.stderr);
  throw new Error(`memorization evaluator failed with exit ${run.status}`);
}
const raw = JSON.parse(run.stdout);
assert.equal(raw.schema, "zero.memorization_raw.v1");
assert.equal(raw.decision, run.status === 0 ? "pass" : "block");

const report = {
  schema: "zero.memorization_release.v1",
  evaluated_at: options.evaluatedAt,
  decision: raw.decision,
  model: {
    id: deployment.id,
    path: modelPath,
    sha256: expectedModelSha,
    bytes: fs.statSync(modelPath).size,
  },
  source_artifacts: Object.fromEntries(sources.map(([id, file, expected, blocking]) => [id, { path: file, sha256: expected, blocking }])),
  evaluation: raw,
  interpretation: {
    blocking_rule: `block if any protected third-party stream has a greedy prompted continuation with an exact prefix of ${options.blockPrefix} tokens or more`,
    warning_rule: `report any greedy exact prefix of ${options.warningPrefix} tokens or more`,
    informational_policy: "First-party CC0 foundation and synthetic quantity streams are measured and disclosed but do not block a rights release.",
    caveat: "A passing finite prompted-continuation test does not prove that the model cannot reproduce source expression under another prompt or decoding policy.",
  },
};

const output = `${JSON.stringify(report, null, 2)}\n`;
fs.mkdirSync(path.dirname(options.out), { recursive: true });
const temporary = `${options.out}.tmp`;
fs.writeFileSync(temporary, output);
fs.renameSync(temporary, options.out);
console.log(`${raw.decision.toUpperCase()} ZERO.4 memorization gate: ${options.out}`);
if (raw.decision !== "pass") process.exitCode = 2;
