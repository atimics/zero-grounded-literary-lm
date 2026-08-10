#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const TEMPLATE = "benchmarks/zero4-q29-v1/pilot-budget.json";

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const options = {
    out: null,
    "source-commit": null,
    "approval-id": null,
    "approved-by": null,
    "approved-at": null,
  };
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    assert(option.startsWith("--") && index + 1 < argv.length,
      `unknown or incomplete option ${option}`);
    const key = option.slice(2);
    assert(Object.hasOwn(options, key), `unknown option ${option}`);
    options[key] = argv[++index];
  }
  for (const [key, value] of Object.entries(options)) {
    assert(value, `missing --${key}`);
  }
  return options;
}

export function materialize(template, options) {
  assert.equal(template.schema,
    "zero.q29_conservative_exposure_pilot_budget.v1");
  assert.equal(template.status,
    "activation_implementation_authorized_run_not_authorized");
  assert.equal(template.authorization.authorized, false);
  assert.equal(template.authorization.maximum_optimizer_updates, 0);
  assert.equal(template.authorization.maximum_quantity_compute_usd, 0);
  assert.match(options["source-commit"], /^[0-9a-f]{40}$/);
  assert.match(options["approval-id"], /^q29-[a-z0-9-]+$/);
  assert.match(options["approved-by"], /^[A-Za-z0-9_.-]+$/);
  assert.match(options["approved-at"], /^\d{4}-\d{2}-\d{2}T/);
  const runtime = structuredClone(template);
  runtime.status = "run_authorized";
  runtime.proposed.source_commit = options["source-commit"];
  runtime.authorization = {
    authorized: true,
    one_execution_only: true,
    approval_id: options["approval-id"],
    approved_by: options["approved-by"],
    approved_at: options["approved-at"],
    source_commit: options["source-commit"],
    profile_sha256: template.profile.sha256,
    maximum_optimizer_updates:
      template.proposed.maximum_optimizer_updates,
    maximum_quantity_compute_usd:
      template.proposed.maximum_quantity_compute_usd,
    language_gate_authorized: false,
    promotion_authorized: false,
  };
  return runtime;
}

function selfTest() {
  const template = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  const runtime = materialize(template, {
    "source-commit": "a".repeat(40),
    "approval-id": "q29-test-one-shot",
    "approved-by": "atimics",
    "approved-at": "2026-08-10T00:00:00Z",
  });
  assert.equal(runtime.authorization.maximum_optimizer_updates, 100);
  assert.equal(runtime.authorization.maximum_quantity_compute_usd, 0.25);
  assert.equal(runtime.authorization.language_gate_authorized, false);
  const bad = structuredClone(template);
  bad.authorization.authorized = true;
  assert.throws(() => materialize(bad, {
    "source-commit": "a".repeat(40),
    "approval-id": "q29-test-one-shot",
    "approved-by": "atimics",
    "approved-at": "2026-08-10T00:00:00Z",
  }));
  console.log("Q2.9 runtime budget materializer self-test passed");
}

function main() {
  const options = parseArgs(process.argv);
  if (options.selfTest) return selfTest();
  assert(!fs.existsSync(options.out), "refuse to overwrite runtime budget");
  const template = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  const runtime = materialize(template, options);
  fs.writeFileSync(options.out, `${JSON.stringify(runtime, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(`wrote one-shot Q2.9 runtime budget to ${options.out}`);
}

main();
