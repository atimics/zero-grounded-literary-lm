#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const TEMPLATE = "benchmarks/zero4-q32-promotion-v1/budget-template.json";
const CONTRACT = "benchmarks/zero4-q32-promotion-v1/contract.json";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = { out: null, "source-commit": null, "approval-id": null,
    "approved-by": null, "approved-at": null };
  for (let index = 2; index < argv.length; ++index) {
    const key = argv[index].slice(2);
    assert(argv[index].startsWith("--") && Object.hasOwn(options, key) &&
      index + 1 < argv.length, `unknown or incomplete option ${argv[index]}`);
    options[key] = argv[++index];
  }
  for (const [key, value] of Object.entries(options))
    assert(value, `missing --${key}`);
  return options;
}

export function materialize(template, options, contractHash) {
  assert.equal(template.schema, "zero.q32_quantity_promotion_budget.v1");
  assert.equal(template.status, "implementation_staged_run_not_authorized");
  assert.equal(template.authorization.authorized, false);
  assert.equal(template.authorization.maximum_promotion_records, 0);
  assert.equal(template.authorization.maximum_compute_usd, 0);
  assert.match(options["source-commit"], /^[0-9a-f]{40}$/);
  assert.match(options["approval-id"], /^q32-promotion-[a-z0-9-]+$/);
  assert.match(options["approved-by"], /^[A-Za-z0-9_.-]+$/);
  assert.match(options["approved-at"], /^\d{4}-\d{2}-\d{2}T/);
  const runtime = structuredClone(template);
  runtime.status = "run_authorized";
  runtime.proposed.source_commit = options["source-commit"];
  runtime.authorization = {
    authorized: true, one_execution_only: true,
    approval_id: options["approval-id"], approved_by: options["approved-by"],
    approved_at: options["approved-at"], source_commit: options["source-commit"],
    contract_sha256: contractHash,
    candidate_sha256: template.proposed.candidate_sha256,
    public_result_sha256: template.proposed.public_result_sha256,
    maximum_promotion_records: template.proposed.promotion_records,
    maximum_compute_usd: template.proposed.maximum_compute_usd,
    training_updates: 0, language_gate_authorized: false,
    deployment_authorized: false, additional_seed_authorized: false,
  };
  return runtime;
}

function selfTest() {
  const template = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  const runtime = materialize(template, {
    "source-commit": "a".repeat(40), "approval-id": "q32-promotion-test",
    "approved-by": "ratimics", "approved-at": "2026-08-12T00:00:00Z",
  }, "b".repeat(64));
  assert.equal(runtime.authorization.maximum_promotion_records, 500);
  assert.equal(runtime.authorization.training_updates, 0);
  assert.equal(runtime.authorization.language_gate_authorized, false);
  const bad = structuredClone(template); bad.authorization.authorized = true;
  assert.throws(() => materialize(bad, {
    "source-commit": "a".repeat(40), "approval-id": "q32-promotion-test",
    "approved-by": "ratimics", "approved-at": "2026-08-12T00:00:00Z",
  }, "b".repeat(64)));
  console.log("Q3.2 promotion budget materializer self-test passed");
}

const options = parseArgs(process.argv);
if (options.selfTest) selfTest();
else {
  assert(!fs.existsSync(options.out), "refuse to overwrite runtime budget");
  const template = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  fs.writeFileSync(options.out,
    `${JSON.stringify(materialize(template, options, sha256(CONTRACT)), null, 2)}\n`,
    { flag: "wx" });
  console.log(`wrote one-shot Q3.2 promotion budget to ${options.out}`);
}
