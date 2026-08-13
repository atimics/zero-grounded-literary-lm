import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const expectedModelSha = "44b32f2262be2754fd2eeaf16ed206bae32b4ce30d7f5541a1059cd21257ae50";
const expectedSourceIds = [
  "zero-foundation",
  "shakespeare",
  "blake",
  "crowley",
  "bible-kjv",
  "literary-channel",
  "quantity-requests",
];
const requiredLegalFiles = [
  "LICENSE",
  "LICENSE-MODEL.md",
  "LICENSE-DATA.md",
  "LICENSES.md",
  "NOTICE",
  "CORPUS_RIGHTS.md",
];
for (const file of requiredLegalFiles) assert(fs.statSync(file).size > 0, `missing legal file: ${file}`);
assert(fs.readFileSync("LICENSE", "utf8").includes("Apache License\n                           Version 2.0"));
assert(fs.readFileSync("LICENSE-MODEL.md", "utf8").includes("creativecommons.org/licenses/by-sa/4.0/legalcode.en"));

const rights = readJson("corpus/RIGHTS.json");
assert.equal(rights.schema, "zero.corpus_rights.v1");
assert.equal(rights.model.sha256, expectedModelSha);
assert.equal(rights.model.license, "CC-BY-SA-4.0");
assert.equal(rights.release_policy.status, "ready_memorization_gate_passed");
assert.equal(rights.release_policy.training_text_in_model_repository, false);
assert.deepEqual(rights.sources.map((source) => source.id), expectedSourceIds);
for (const source of rights.sources) {
  if (source.normalized_source && fs.existsSync(source.normalized_source)) {
    assert.equal(sha256(source.normalized_source), source.normalized_source_sha256, `normalized source hash drifted: ${source.id}`);
  }
}

const teachers = readJson("teachers/registry.json");
const teacherHashes = Object.fromEntries(teachers.teachers.map((teacher) => [teacher.id, teacher.artifact_sha256]));
assert.deepEqual(rights.lineage.immutable_teachers, teacherHashes, "teacher lineage drifted");

const deployment = readJson("docs/model.json");
assert.equal(deployment.artifact.sha256, expectedModelSha);
assert.equal(sha256(deployment.artifact.path), expectedModelSha);
assert.equal(deployment.release.model_license, "CC-BY-SA-4.0");
assert.equal(deployment.release.code_license, "Apache-2.0");
assert.equal(deployment.release.training_text_distributed_with_model, false);

const report = readJson(rights.release_policy.memorization_result);
assert.equal(report.schema, "zero.memorization_release.v1");
assert.equal(report.decision, "pass");
assert.equal(report.model.sha256, expectedModelSha);
assert.equal(report.evaluation.decision, "pass");
assert.deepEqual(report.evaluation.sources.map((source) => source.id), expectedSourceIds);
assert.equal(report.evaluation.settings.prompt_tokens, 128);
assert.equal(report.evaluation.settings.continuation_tokens, 64);
assert.equal(report.evaluation.settings.samples_per_source, 16);
assert.equal(report.evaluation.settings.warning_exact_prefix, 32);
assert.equal(report.evaluation.settings.block_exact_prefix, 64);
for (const source of report.evaluation.sources) {
  const artifact = report.source_artifacts[source.id];
  assert.equal(artifact.sha256, rights.sources.find((entry) => entry.id === source.id).training_artifact_sha256);
  assert.equal(source.blocking, artifact.blocking, `memorization policy drifted: ${source.id}`);
  if (source.blocking) {
    assert(source.max_exact_prefix < report.evaluation.settings.block_exact_prefix, `blocked memorization source: ${source.id}`);
    assert.equal(source.full_exact_continuations, 0, `full exact continuation found: ${source.id}`);
    assert.equal(source.warning_samples, 0, `third-party warning threshold reached: ${source.id}`);
  }
}
assert(report.evaluation.sources.find((source) => source.id === "zero-foundation").full_exact_continuations > 0, "foundation disclosure drifted");

const release = readJson("huggingface/release-manifest.json");
assert.equal(release.schema, "zero.huggingface_release.v1");
assert.equal(release.release_status, "ready");
assert.equal(release.repository_license_metadata, "cc-by-sa-4.0");
const targets = new Set();
for (const file of release.files) {
  assert(!targets.has(file.target), `duplicate release target: ${file.target}`);
  targets.add(file.target);
  assert(fs.existsSync(file.source), `release source missing: ${file.source}`);
  assert(!release.forbidden_source_prefixes.some((prefix) => file.source.startsWith(prefix)), `forbidden release source: ${file.source}`);
  if (file.sha256) assert.equal(sha256(file.source), file.sha256, `release hash drifted: ${file.source}`);
  if (file.bytes) assert.equal(fs.statSync(file.source).size, file.bytes, `release size drifted: ${file.source}`);
}
assert(targets.has("model.litq8") && targets.has("README.md") && targets.has("CORPUS_RIGHTS.md"));
const card = fs.readFileSync("huggingface/README.md", "utf8");
assert(card.startsWith("---\nlicense: cc-by-sa-4.0\n"), "Hugging Face license metadata drifted");
assert(card.includes("not directly compatible with `transformers.AutoModel`"));
assert(card.includes("No human chat export"));

console.log(`OK ZERO.4 corpus rights: ${expectedModelSha}`);
console.log(`OK Hugging Face allowlist: ${release.files.length} files, no training text`);
console.log(`OK memorization gate: ${report.evaluation.sources.length} bound sources`);
