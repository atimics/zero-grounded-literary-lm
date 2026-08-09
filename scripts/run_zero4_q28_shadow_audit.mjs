#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONTRACT = "benchmarks/zero4-q28-v1/contract.json";
const Q26 = "benchmarks/zero4-q26-v1/contract.json";
const REPLAY = [
  ["--text", "corpus/bpe/zero-foundation.tok"],
  ["--text", "corpus/bpe/shakespeare.tok"],
  ["--text", "corpus/bpe/blake.tok"],
  ["--text", "corpus/bpe/crowley.tok"],
  ["--text", "corpus/bpe/bible-kjv.tok"],
  ["--channel", "corpus/channel/literary-dialogue.tok"],
];
const FORBIDDEN = [
  "blimp", "tinystories", "public.tsv", "promotion.tsv", "language-gate",
];

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function atomicJson(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${command} exited ${result.status}`);
}
function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = {
    out: "benchmarks/zero4-q28-v1/audit",
    data: "corpus/faculty/q22",
    mechanics: "./graded_plasticity_audit",
  };
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (!option.startsWith("--") || index + 1 >= argv.length) {
      fail(`unknown or incomplete option ${option}`);
    }
    const key = option.slice(2);
    assert(Object.hasOwn(options, key), `unknown option ${option}`);
    options[key] = argv[++index];
  }
  return options;
}
function parseProfile(file, expectedNames) {
  const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
  assert(lines.shift() === "zero.graded_plasticity_profile.v1",
    "wrong plasticity profile schema");
  assert(lines.length === expectedNames.length, "profile group count drifted");
  return lines.map((line, index) => {
    const [name, raw, extra] = line.split("\t");
    const coefficient = Number(raw);
    assert(extra === undefined && name === expectedNames[index],
      "profile group ordering drifted");
    assert(Number.isFinite(coefficient) && coefficient >= 0.05 &&
      coefficient <= 1, `invalid coefficient for ${name}`);
    return { name, coefficient };
  });
}
function validateAudit(audit, profile) {
  assert(audit.schema === "zero.graded_plasticity_shadow_audit.v1",
    "wrong shadow-audit schema");
  assert(audit.training_only === true && audit.updates_committed === 0,
    "shadow audit committed training");
  assert(audit.weights_and_optimizer_byte_identical === true &&
    audit.learned_state_digest_before === audit.learned_state_digest_after,
    "shadow audit changed learned state");
  assert(audit.deterministic_samples_per_range >= 1 &&
    audit.deterministic_samples_per_range <= 16,
    "invalid shadow-audit sample count");
  assert(audit.replay_training_ranges === 6,
    "shadow audit did not use all six replay ranges");
  assert(Array.isArray(audit.groups) && audit.groups.length === profile.length,
    "shadow-audit/profile group count mismatch");
  for (let index = 0; index < profile.length; ++index) {
    const group = audit.groups[index];
    assert(group.name === profile[index].name &&
      Math.abs(group.plasticity - profile[index].coefficient) <= 1e-8,
    `shadow-audit/profile mismatch for ${group.name}`);
    for (const field of [
      "quantity_gradient_energy", "replay_gradient_energy",
      "optimizer_delta_norm", "scaled_delta_norm", "projected_delta_norm",
      "predicted_replay_drift", "predicted_quantity_loss_change",
    ]) assert(Number.isFinite(group[field]), `${field} is not finite`);
  }
  const projection = audit.projection;
  assert(Number.isFinite(projection.pre_dot) &&
    Number.isFinite(projection.post_dot), "projection diagnostic is not finite");
  if (projection.pre_dot > 0) {
    assert(projection.applied === true,
      "positive replay drift did not activate projection");
    assert(Math.abs(projection.post_dot) <=
      1e-3 * (1 + Math.abs(projection.pre_dot)),
    "weighted projection left excessive first-order replay drift");
  }
}
function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zero-q28-audit-"));
  const profilePath = path.join(root, "profile.tsv");
  fs.writeFileSync(profilePath,
    "zero.graded_plasticity_profile.v1\na\t0.05\nb\t1\n");
  const profile = parseProfile(profilePath, ["a", "b"]);
  const groups = profile.map(({ name, coefficient }) => ({
    name, plasticity: coefficient, quantity_gradient_energy: 1,
    replay_gradient_energy: 1, optimizer_delta_norm: 1,
    scaled_delta_norm: coefficient, projected_delta_norm: coefficient,
    predicted_replay_drift: 0, predicted_quantity_loss_change: -1,
  }));
  validateAudit({
    schema: "zero.graded_plasticity_shadow_audit.v1",
    training_only: true, updates_committed: 0,
    weights_and_optimizer_byte_identical: true,
    learned_state_digest_before: "x", learned_state_digest_after: "x",
    deterministic_samples_per_range: 4, replay_training_ranges: 6, groups,
    projection: { applied: true, pre_dot: 1, post_dot: 0 },
  }, profile);
  let rejected = false;
  fs.writeFileSync(profilePath,
    "zero.graded_plasticity_profile.v1\na\t0.049\nb\t1\n");
  try { parseProfile(profilePath, ["a", "b"]); } catch { rejected = true; }
  assert(rejected, "out-of-bounds profile was accepted");
  console.log("Q2.8 shadow-audit driver self-test passed");
}

const options = parseArgs(process.argv);
if (options.selfTest) {
  selfTest();
  process.exit(0);
}

const contract = readJson(CONTRACT);
const q26 = readJson(Q26);
assert(contract.status === "implementation_only_not_authorized" &&
  contract.training_allowed === false &&
  contract.proposed_paid_pilot.authorized === false,
"Q2.8 implementation contract opened training authority");
assert(sha256(Q26) === contract.lineage.q26_contract.sha256,
  "Q2.6 contract binding drifted");
for (const binding of [
  contract.lineage.post_q27_hypotheses,
  contract.lineage.post_q27_literature,
  contract.lineage.post_q27_trace,
]) assert(sha256(binding.path) === binding.sha256,
  `research binding drifted: ${binding.path}`);

const quantity = path.join(options.data, "quantity-request.tok");
const inputs = [
  "teachers/zero3-balanced-final.teacher", "corpus/literary.bpe",
  ...REPLAY.map((entry) => entry[1]), quantity,
];
for (const file of [options.mechanics, ...inputs]) {
  assert(fs.existsSync(file), `required audit input missing: ${file}`);
  const lowered = file.toLowerCase();
  assert(!FORBIDDEN.some((word) => lowered.includes(word)),
    `forbidden audit input: ${file}`);
}
assert(sha256(inputs[0]) === contract.shadow_audit.initialization_sha256,
  "ZERO.3 initialization drifted");
assert(sha256(quantity) === q26.quantity_corpus.tokens_sha256,
  "quantity training tokens drifted");
for (const file of inputs.slice(1, -1)) {
  assert(sha256(file) === q26.replay_corpus[file],
    `replay training input drifted: ${file}`);
}

fs.mkdirSync(options.out, { recursive: true });
const rawAudit = path.join(options.out, "shadow-audit.json");
const profilePath = path.join(options.out, "profile.tsv");
const manifestPath = path.join(options.out, "manifest.json");
for (const file of [rawAudit, profilePath, manifestPath]) {
  assert(!fs.existsSync(file), `refusing to overwrite audit output: ${file}`);
}
run(options.mechanics, [
  "--init", inputs[0], "--quantity", quantity,
  "--audit-json", rawAudit, "--profile-out", profilePath,
  "--samples", String(contract.shadow_audit.deterministic_samples_per_range),
]);
const audit = readJson(rawAudit);
const profile = parseProfile(profilePath, audit.groups.map((group) => group.name));
validateAudit(audit, profile);
const inputHashes = Object.fromEntries(inputs.map((file) =>
  [file, sha256(file)]));
atomicJson(manifestPath, {
  schema: "zero.graded_plasticity_audit_manifest.v1",
  experiment: contract.id,
  training_only: true,
  updates_committed: 0,
  forbidden_evaluation_inputs_used: false,
  inputs: {
    contract: { path: CONTRACT, sha256: sha256(CONTRACT) },
    trainer: {
      path: "graded_plasticity_audit.c",
      sha256: sha256("graded_plasticity_audit.c"),
    },
    files: inputHashes,
  },
  outputs: {
    audit: { path: rawAudit, sha256: sha256(rawAudit) },
    profile: { path: profilePath, sha256: sha256(profilePath) },
  },
  profile_summary: {
    groups: profile.length,
    minimum: Math.min(...profile.map((group) => group.coefficient)),
    maximum: Math.max(...profile.map((group) => group.coefficient)),
  },
  learned_state_digest_before: audit.learned_state_digest_before,
  learned_state_digest_after: audit.learned_state_digest_after,
  weights_and_optimizer_byte_identical:
    audit.weights_and_optimizer_byte_identical,
});
console.log(`Q2.8 no-update audit passed; profile sha256=${sha256(profilePath)}`);
