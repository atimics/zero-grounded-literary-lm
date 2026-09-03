#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const contractPath = "benchmarks/zero5-ht1-mergetree-v1/contract.json";
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const artifact = file => {
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
};
const finite = (value, name, minimum = 0, maximum = Infinity) => {
  assert.equal(typeof value, "number", `${name} must be a number`);
  assert(Number.isFinite(value) && value >= minimum && value <= maximum,
    `${name} must be finite and within bounds`);
  return value;
};
const count = (value, name) => {
  finite(value, name);
  assert(Number.isSafeInteger(value), `${name} must be a safe integer`);
  return value;
};

export function summarizeDepth(score) {
  assert.equal(score.schema, "zero.ht1_depth_eval.v1");
  assert(count(score.packs, "packs") > 0);
  assert.deepEqual(score.bands.map(band => band.depth), ["0", "1", "2+"]);
  const total = { targets: 0, raw_bytes: 0, structural_targets: 0, total_nats: 0 };
  const bands = score.bands.map(band => {
    for (const key of ["targets", "raw_bytes", "structural_targets"])
      total[key] += count(band[key], key);
    assert(band.structural_targets <= band.targets);
    if (band.depth !== "0") assert.equal(band.structural_targets, 0);
    assert(band.raw_bytes >= band.targets - band.structural_targets);
    total.total_nats += finite(band.total_nats, "total_nats");
    if (band.targets === 0) assert.equal(band.total_nats, 0);
    return { ...band,
      nats_per_target: band.targets ? band.total_nats / band.targets : null,
      bits_per_raw_byte: band.raw_bytes ? band.total_nats / Math.LN2 / band.raw_bytes : null };
  });
  for (const key of ["targets", "raw_bytes", "structural_targets"]) count(total[key], key);
  assert(total.targets > 0 && total.raw_bytes > 0);
  return { packs: score.packs, bands, total: { ...total,
    nats_per_target: total.total_nats / total.targets,
    bits_per_raw_byte: total.total_nats / Math.LN2 / total.raw_bytes } };
}

function tasks(value) {
  for (const name of ["combined_nats_per_token", "evidence_nats_per_token",
    "atlas_nats_per_token", "anchor_nats_per_token"]) finite(value[name], name);
  return {
    claim: finite(value.choice.claim.choice_accuracy, "claim accuracy", 0, 1),
    cloze: finite(value.cloze.top1_token_accuracy, "cloze token accuracy", 0, 1),
    retrieval: finite(value.choice.retrieval.choice_accuracy, "retrieval accuracy", 0, 1),
    pair: finite(value.choice.retrieval.pair_exact_accuracy, "pair accuracy", 0, 1),
  };
}

export function evaluateHT1Gates(candidate, control, candidateDepth, controlDepth,
  limits, evidence = null) {
  const observed = tasks(candidate), baseline = tasks(control);
  const current = summarizeDepth(candidateDepth), previous = summarizeDepth(controlDepth);
  assert.equal(current.packs, previous.packs);
  for (let i = 0; i < 3; i++) {
    for (const key of ["targets", "raw_bytes", "structural_targets"])
      assert.equal(current.bands[i][key], previous.bands[i][key], `depth ${i}: ${key}`);
  }
  assert(previous.total.bits_per_raw_byte > 0);
  assert(previous.bands[2].nats_per_target > 0, "depth 2+ requires measured targets");
  const derived = {
    bits_per_byte_reduction: 1 - current.total.bits_per_raw_byte / previous.total.bits_per_raw_byte,
    deep_merge_nats_reduction: 1 - current.bands[2].nats_per_target / previous.bands[2].nats_per_target,
    accuracy_change: Object.fromEntries(Object.keys(observed).map(name =>
      [name, observed[name] - baseline[name]])),
  };
  const checks = {
    byte_compression: derived.bits_per_byte_reduction >=
      limits.overall_bits_per_byte_relative_reduction_minimum,
    deep_merge_loss: derived.deep_merge_nats_reduction >=
      limits.deep_merge_nats_relative_reduction_minimum,
    ...Object.fromEntries(Object.keys(observed).map(name =>
      [`${name}_preservation`, derived.accuracy_change[name] >= -limits.maximum_task_accuracy_loss])),
    combined_retention: candidate.combined_nats_per_token <=
      control.combined_nats_per_token + limits.maximum_combined_nats_increase,
    evidence_retention: candidate.evidence_nats_per_token <= limits.maximum_evidence_nats,
    atlas_retention: candidate.atlas_nats_per_token <= limits.maximum_atlas_nats,
    anchor_retention: candidate.anchor_nats_per_token <= limits.maximum_anchor_nats,
    mechanics: null, compute: null, wall_time: null, sealed_test: null,
  };
  if (evidence !== null) {
    for (const key of ["gate_off_shared_state_identity", "gate_off_logits_and_loss_identity",
      "exact_round_trip", "causality", "finite_gradients", "tied_effective_table"])
      assert.equal(typeof evidence.mechanics[key], "boolean", `mechanics.${key}`);
    count(evidence.mechanics.gate_off_updates, "gate_off_updates");
    checks.mechanics = evidence.mechanics.gate_off_updates === 10 &&
      Object.entries(evidence.mechanics).filter(([, value]) => typeof value === "boolean")
        .every(([, value]) => value);
    finite(evidence.resources.compute_ratio, "compute_ratio", Number.MIN_VALUE);
    finite(evidence.resources.wall_time_ratio, "wall_time_ratio", Number.MIN_VALUE);
    checks.compute = evidence.resources.compute_ratio <= limits.maximum_compute_ratio;
    checks.wall_time = evidence.resources.wall_time_ratio <= limits.maximum_wall_time_ratio;
    for (const key of ["content_present", "parsed", "tokenized", "packed", "scored", "metrics_opened"])
      assert.equal(typeof evidence.test[key], "boolean", `test.${key}`);
    checks.sealed_test = Object.values(evidence.test).every(value => value === false);
  }
  const pending = Object.entries(checks).filter(([, value]) => value === null).map(([key]) => key);
  return { derived, checks, pending, passed: Object.values(checks).every(value => value === true),
    depth: { candidate: current, control: previous } };
}

function selfTest() {
  const limits = JSON.parse(fs.readFileSync(contractPath)).gates;
  const score = loss => ({ schema: "zero.ht1_depth_eval.v1", packs: 1,
    bands: ["0", "1", "2+"].map((depth, i) => ({ depth, targets: 10,
      raw_bytes: 10 * (i + 1), structural_targets: 0, total_nats: loss })) });
  const model = { combined_nats_per_token: 2, evidence_nats_per_token: 2.2,
    atlas_nats_per_token: 2.3, anchor_nats_per_token: 3.8,
    cloze: { top1_token_accuracy: .5 },
    choice: { claim: { choice_accuracy: .6 },
      retrieval: { choice_accuracy: .6, pair_exact_accuracy: .6 } } };
  const evidence = { mechanics: { gate_off_shared_state_identity: true,
    gate_off_logits_and_loss_identity: true, exact_round_trip: true, causality: true,
    finite_gradients: true, tied_effective_table: true, gate_off_updates: 10 },
  resources: { compute_ratio: 1.01, wall_time_ratio: 1.02 },
  test: Object.fromEntries(["content_present", "parsed", "tokenized", "packed", "scored",
    "metrics_opened"].map(key => [key, false])) };
  const check = (candidate = model, candidateScore = score(18), proof = evidence) =>
    evaluateHT1Gates(candidate, model, candidateScore, score(20), limits, proof);
  assert.equal(check().passed, true);
  assert.equal(check(model, score(18), null).passed, false);
  assert.equal(check(model, score(20)).checks.byte_compression, false);
  const shallow = score(18); shallow.bands[2].total_nats = 20;
  assert.equal(check(model, shallow).checks.deep_merge_loss, false);
  for (const name of ["combined_nats_per_token", "evidence_nats_per_token",
    "atlas_nats_per_token", "anchor_nats_per_token"]) {
    const changed = structuredClone(model); changed[name] = 9;
    assert.equal(check(changed).passed, false);
  }
  for (const keys of [["choice", "claim", "choice_accuracy"],
    ["choice", "retrieval", "choice_accuracy"], ["choice", "retrieval", "pair_exact_accuracy"],
    ["cloze", "top1_token_accuracy"]]) {
    const changed = structuredClone(model);
    let target = changed;
    for (const key of keys.slice(0, -1)) target = target[key];
    target[keys.at(-1)] = .1;
    assert.equal(check(changed).passed, false);
  }
  for (const key of ["compute_ratio", "wall_time_ratio"]) {
    const changed = structuredClone(evidence); changed.resources[key] = 1.04;
    assert.equal(check(model, score(18), changed).passed, false);
  }
  const opened = structuredClone(evidence); opened.test.scored = true;
  assert.equal(check(model, score(18), opened).passed, false);
  const short = structuredClone(evidence); short.mechanics.gate_off_updates = 9;
  assert.equal(check(model, score(18), short).passed, false);
  const empty = score(20); empty.bands[2].targets = 0;
  assert.throws(() => check(model, empty));
  assert.throws(() => check({ ...model, evidence_nats_per_token: NaN }));
  assert.throws(() => check({ ...model, cloze: {} }));
  const mismatch = score(18); mismatch.bands[0].raw_bytes++;
  assert.throws(() => check(model, mismatch));
  process.stdout.write("HT1 evaluator self-test passed\n");
}

function main() {
  if (process.argv.includes("--self-test")) { selfTest(); return; }
  const option = (key, fallback = null) => {
    const index = process.argv.indexOf(key);
    if (index < 0) return fallback;
    assert(index + 1 < process.argv.length, `${key} requires a value`);
    return process.argv[index + 1];
  };
  const readJSON = file => JSON.parse(fs.readFileSync(file));
  const requireHash = (file, expected) => {
    const observed = artifact(file);
    assert.equal(observed.sha256, expected, `artifact hash: ${file}`);
    return observed;
  };
  const contract = readJSON(contractPath), series = readJSON(contract.series.path);
  requireHash(contract.series.path, contract.series.sha256);
  requireHash(contract.control.contract, contract.control.contract_sha256);
  const files = Object.fromEntries(["checkpoint", "control-checkpoint", "tokenizer",
    "validation", "control-result"].map(name => {
    const value = option(`--${name}`); assert(value, `--${name} is required`);
    return [name, path.resolve(value)];
  }));
  const controlResultArtifact = requireHash(files["control-result"], contract.control.private_result_sha256);
  const controlResult = readJSON(files["control-result"]);
  assert.equal(controlResult.schema, "zero.c51_statebridge_result.v1");
  assert.equal(controlResult.contract_sha256, contract.control.contract_sha256);
  const controlCheckpoint = requireHash(files["control-checkpoint"], controlResult.checkpoints.best.sha256);
  const tokenizer = requireHash(files.tokenizer, contract.tokenizer.sha256);
  const validation = requireHash(files.validation, series.shared_inputs.combined_validation_sha256);
  const selected = artifact(files.checkpoint);
  const trainer = path.resolve(option("--trainer", "./zero5_ht1_mergetree_lm"));
  const measure = checkpoint => {
    const result = spawnSync(trainer, ["--init", checkpoint, "--tokenizer", files.tokenizer,
      "--depth-eval", files.validation], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  };
  const depth = { candidate: measure(files.checkpoint), control: measure(files["control-checkpoint"]) };
  const result = { schema: "zero.ht1_validation_result.v1", experiment: contract.experiment,
    status: "depth-scored-awaiting-task-and-resource-evidence", contract_sha256: artifact(contractPath).sha256,
    checkpoint: selected, control_checkpoint: controlCheckpoint, control_result: controlResultArtifact,
    tokenizer, validation, trainer: artifact(trainer),
    depth: { candidate: summarizeDepth(depth.candidate), control: summarizeDepth(depth.control) },
    replication_eligible: false, promotion_eligible: false, test: { metrics_opened: false } };
  const taskPath = option("--candidate-tasks");
  if (taskPath) {
    const candidate = readJSON(taskPath);
    assert.equal(candidate.schema, "zero.c51_statebridge_validation.v1");
    assert.equal(candidate.contract_sha256, contract.control.contract_sha256);
    assert.equal(candidate.checkpoint.sha256, selected.sha256);
    assert.equal(candidate.test.metrics_opened, false);
    assert.equal(controlResult.validation.test.metrics_opened, false);
    const evidencePath = option("--evidence");
    let evidence = null;
    if (evidencePath) {
      evidence = readJSON(evidencePath);
      assert.equal(evidence.schema, "zero.ht1_preflight_evidence.v1");
      assert.equal(evidence.experiment, contract.experiment);
      assert.equal(evidence.contract_sha256, artifact(contractPath).sha256);
      assert.equal(evidence.bindings.initial_checkpoint_sha256,
        series.shared_inputs.initial_checkpoint_sha256);
      assert.equal(evidence.bindings.training_packs_sha256,
        series.shared_inputs.training_packs_sha256);
      assert.equal(evidence.bindings.validation_packs_sha256, validation.sha256);
      assert.equal(evidence.bindings.tokenizer_sha256, tokenizer.sha256);
      assert.equal(evidence.bindings.control_checkpoint_sha256,
        controlCheckpoint.sha256);
      assert.equal(evidence.bindings.candidate_checkpoint_sha256, selected.sha256);
      assert.equal(evidence.bindings.trainer_sha256, artifact(trainer).sha256);
      assert.equal(evidence.test.metrics_opened, false);
    }
    const gateResult = evaluateHT1Gates(candidate.candidate,
      controlResult.validation.candidate, depth.candidate, depth.control,
      contract.gates, evidence);
    Object.assign(result, { status: gateResult.pending.length
      ? "scored-awaiting-mechanics-and-resource-proof"
      : (gateResult.passed ? "complete-pass" : "complete-no-go"),
      candidate_tasks: artifact(taskPath), candidate: candidate.candidate,
      control: controlResult.validation.candidate, gates: gateResult.checks,
      derived: gateResult.derived, pending: gateResult.pending,
      evidence: evidencePath ? artifact(evidencePath) : null,
      replication_eligible: gateResult.passed });
  }
  const out = option("--out");
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    process.stderr.write(`error: ${error.message}\n`); process.exitCode = 1;
  }
}
