import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const version = Number(process.argv[2]);
assert.ok([53, 54].includes(version));
const id = version === 53 ? "reasoner53-evidence-transfer-v1" : "reasoner54-pixel-transfer-v1";
const expected = version === 53 ? {
  result: "253f4f5354c7baf6820c06fe5d05a00415d45d3837619c375f8ac9a9b8f22c3d",
  execution: "cfe5bcfbfe8252d669620b8cff68148444fc47fd7e00771ecbd24e4b037112d5",
  contract: "10c01fc15d6cc69cd4bf8958bb93c08096e6278b202253aeeea49e46fba9624c",
  artifact: "da93fa00c5539e25a5e397d538eb5e7eb836c38d34842e5a4bc6ac5188a30164",
  lock: "c812fc71bcd5ce4ed123bc2fb3fffa839357aaa216df904cccf6451bcde490f7",
  decision: "pass", episodes: 72, primary: 2,
} : {
  result: "270bd61497c38059d22a53aa2f3a24f99a8fff07e76f7b800694d4328a307bd3",
  execution: "9b361ddb82800a2164e442f29db7ff5d17ddd4cd04c1003c1b7edfe15c391012",
  contract: "88f22d629da710c050275d84f8c857fd5ebdae162d302c5e84f998e0347c3f57",
  artifact: "e9113e35cf7b8f94bbfb38b64a4c798867f1a20df120a7b5b7231b82671dfe0f",
  lock: "6a5427fbf6c508b91978bc7fe25bdcc958bdda0f41825900efc58b087e6d8a4a",
  decision: "no-go", episodes: 48, primary: 1,
};
const dir = `benchmarks/${id}`;
const bytes = name => readFileSync(`${dir}/${name}`);
const hash = value => createHash("sha256").update(value).digest("hex");
const raw = bytes("RESULT.json");
const executionRaw = bytes("EXECUTION.json");
const contractRaw = bytes("contract.json");
const result = JSON.parse(raw);
const execution = JSON.parse(executionRaw);
const provenance = JSON.parse(bytes("PROVENANCE.json"));
const hex = bytes("ARTIFACT.hex").toString().replace(/\s/g, "");
assert.match(hex, /^(?:[0-9a-f]{2})+$/);
const artifact = Buffer.from(hex, "hex");
assert.equal(hash(raw), expected.result);
assert.equal(hash(executionRaw), expected.execution);
assert.equal(hash(contractRaw), expected.contract);
assert.equal(hash(artifact), expected.artifact);
assert.equal(hash(artifact.subarray(0, 176)),
  "7e0e087d14a0380dea21afb008e7a77237a7bd7f660012c789e2615f9b2320e6");
assert.equal(artifact.length, 216);
assert.equal(raw.length, provenance.artifacts.result_bytes);
assert.equal(executionRaw.length, provenance.artifacts.execution_bytes);
assert.equal(provenance.artifacts.execution_lock_sha256, expected.lock);
assert.equal(provenance.source.commit, "4dc4444615d4e8d11e44641f81d975542a315be2");
assert.equal(provenance.source.bundle_sha256,
  "4467b54b633a75aecc0e154fdc75c70e162f22184272aedcf37e77788434ea4b");
assert.equal(provenance.contract_sha256, expected.contract);
assert.equal(provenance.artifacts.result_sha256, expected.result);
assert.equal(provenance.artifacts.execution_sha256, expected.execution);
assert.equal(provenance.artifacts.source_artifact_sha256, expected.artifact);

let digest = 1469598103934665603n ^ BigInt(version);
for (const byte of artifact) {
  digest ^= BigInt(byte);
  digest = BigInt.asUintN(64, digest * 1099511628211n);
}
assert.equal(digest.toString(16).padStart(16, "0"), result.artifact_digest);

const arms = ["full", "target_only", "source_ablation", "shuffled_source",
  "channel_ablation", "source_only", "oracle"];
assert.equal(result.episode_rows.length, expected.episodes);
assert.equal(new Set(result.episode_rows.map(row =>
  `${row.condition}:${row.target}:${row.tie}`)).size, expected.episodes);
let fullMax = 0;
let invalid = 0;
let decoded = 0;
let decodedExact = 0;
let minimumMargin = 17;
let ablationEqual = true;
let oracleEqual = true;
for (let condition = 0; condition < result.conditions.length; condition++) {
  const rows = result.episode_rows.filter(row => row.condition === condition);
  assert.equal(rows.length, 24);
  const summary = result.conditions[condition];
  let wins = 0;
  for (const arm of arms) {
    const expansions = rows.reduce((sum, row) => sum + row.arms[arm].expansions, 0);
    const exact = rows.reduce((sum, row) => sum + row.arms[arm].exact, 0);
    assert.deepEqual(summary.arms[arm], { expansions, exact });
    assert.equal(exact, 24);
  }
  for (const row of rows) {
    assert.ok(row.target >= 0 && row.target < 12);
    assert.ok(row.tie === 0 || row.tie === 1);
    wins += row.arms.full.expansions < row.arms.target_only.expansions;
    fullMax = Math.max(fullMax, row.arms.full.expansions);
    invalid += row.invalid_first;
    decoded += row.decoded;
    decodedExact += row.decoded_exact;
    minimumMargin = Math.min(minimumMargin, row.minimum_margin);
    ablationEqual &&= row.arms.target_only.expansions === row.arms.source_ablation.expansions;
    oracleEqual &&= row.arms.full.expansions === row.arms.oracle.expansions;
  }
  assert.equal(summary.individual_wins, wins);
}
assert.equal(result.full_max_expansions, fullMax);
assert.equal(result.invalid_first_suggestions, invalid);
assert.equal(result.decoded_values, decoded);
assert.equal(result.decoded_exact, decodedExact);
assert.equal(result.minimum_margin, minimumMargin);
assert.equal(result.source_ablation_equal, ablationEqual);
assert.equal(result.oracle_equal, oracleEqual);
const primary = result.conditions[expected.primary];
const gates = {
  frozen: result.artifact_frozen,
  ablation: ablationEqual,
  budget: fullMax <= 64,
  invalid_first: invalid > 0,
  aggregate: primary.arms.full.expansions * 100 <=
    primary.arms.target_only.expansions * 80,
  channel_control: primary.arms.full.expansions < primary.arms.channel_ablation.expansions,
  shuffled_control: primary.arms.full.expansions < primary.arms.shuffled_source.expansions,
  wins: primary.individual_wins >= 12,
  exact: result.conditions.every(condition =>
    arms.every(arm => condition.arms[arm].exact === 24)),
};
if (version === 54) {
  gates.pixel_decode = decoded === decodedExact;
  gates.margin = minimumMargin >= 6;
  gates.oracle = oracleEqual;
}
const failures = Object.entries(gates).filter(([, value]) => !value).map(([name]) => name);
assert.deepEqual(failures, version === 53 ? [] : ["invalid_first", "aggregate", "wins"]);
assert.equal(result.gate_pass, failures.length === 0);
assert.equal(result.decision, expected.decision);
assert.equal(execution.decision, result.decision);
assert.equal(execution.execution_count, 1);
assert.equal(execution.retry_count, 0);
assert.equal(execution.post_open_tuning, false);
assert.ok(execution.elapsed_ms <= 300000);
assert.equal(execution.elapsed_ms, provenance.execution.elapsed_milliseconds);
assert.equal(execution.executed_at_utc, provenance.executed_at_utc);
console.log(`Reasoner ${version} recorded decision and integrity passed`);
