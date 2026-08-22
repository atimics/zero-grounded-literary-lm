#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const PLAN = "corpus/registry/sero-pretrain-v1-acquisition.json";
const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));
assert.equal(plan.schema, "sero.corpus_acquisition.v1");
assert.equal(plan.dataset_id, "sero-pretrain");
assert.match(plan.version, /^\d{4}-\d{2}-\d{2}\.v\d+$/u);
assert(plan.target_clean_utf8_bytes_per_source >= 40_000_000);
assert(plan.minimum_article_utf8_bytes >= 256);
assert.match(plan.extractor.commit, /^[0-9a-f]{40}$/u);
assert.equal(plan.extractor.repository,
  "https://github.com/WikiExtractor/wikiextractor.git");
assert.equal(plan.sources.length, 3);
assert.equal(new Set(plan.sources.map((source) => source.id)).size, plan.sources.length);
for (const source of plan.sources) {
  assert(source.dump_url.startsWith("https://dumps.wikimedia.org/"));
  assert(source.dump_url.includes("/20260801/"), `${source.id} is not a fixed snapshot`);
  assert.match(source.dump_sha1, /^[0-9a-f]{40}$/u);
  assert(source.project_url.startsWith("https://"));
  assert(source.license_url.startsWith("https://creativecommons.org/"));
  assert.equal(source.sampling_weight, 1);
  assert(source.attribution_method.includes("URL"));
}
assert(plan.legal_notice_url === "https://dumps.wikimedia.org/legal.html");
assert(plan.terms_url.includes("foundation.wikimedia.org/wiki/Policy:Terms_of_Use"));
assert.equal(plan.registry.splits.train_permyriad +
  plan.registry.splits.validation_permyriad + plan.registry.splits.test_permyriad, 10_000);
for (const file of [plan.registry.tokenizer, ...plan.registry.contamination_panels]) {
  assert(fs.existsSync(file.path), `missing bound input ${file.path}`);
  assert.match(file.sha256, /^[0-9a-f]{64}$/u);
}
const syntax = spawnSync("python3", ["-c",
  "import ast,pathlib; ast.parse(pathlib.Path('scripts/prepare_sero_corpus.py').read_text())"],
  { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
console.log("Sero corpus acquisition contract passed");
