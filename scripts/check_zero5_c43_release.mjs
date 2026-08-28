#!/usr/bin/env node

import path from "node:path";
import {
  readJson,
  sha256File,
  validateImportPair,
  validateReleaseReport,
} from "./lib/zero5_c43_intake.mjs";

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}
function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
  return process.argv[index + 1];
}

try {
  const proposalPath = option("--proposal",
    "benchmarks/zero5-c43-v1/contract-proposal.json");
  const reportPath = option("--report");
  const firstImportPath = option("--import-a");
  const secondImportPath = option("--import-b");
  const releaseDirectory = option("--release");
  if (!reportPath || !firstImportPath || !secondImportPath) {
    fail("--report, --import-a, and --import-b are required");
  }
  const proposal = readJson(proposalPath);
  const c42Contract = readJson(proposal.c42_decision.contract);
  const report = readJson(reportPath);
  const firstImport = readJson(firstImportPath);
  const secondImport = readJson(secondImportPath);
  const release = validateReleaseReport(report, proposal, c42Contract,
    releaseDirectory ? path.resolve(releaseDirectory) :
      path.dirname(path.resolve(reportPath)));
  const imports = validateImportPair(firstImport, secondImport, report,
    proposal, c42Contract);
  process.stdout.write(JSON.stringify({
    schema: "zero.c43_intake_check.v1",
    status: "pass",
    proposal_sha256: sha256File(proposalPath),
    report_sha256: sha256File(reportPath),
    first_import_sha256: sha256File(firstImportPath),
    second_import_sha256: sha256File(secondImportPath),
    release,
    imports,
    paid_compute_authorized: false,
    test_metrics_opened: false,
  }, null, 2) + "\n");
} catch (error) {
  fail(error.message);
}
