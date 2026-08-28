#!/usr/bin/env node

import path from "node:path";
import {
  readJson,
  selectPilotVariants,
  sha256File,
  validateImportPair,
  validateReleaseReport,
  writeJsonExclusive,
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

function options(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

try {
  const proposalPath = option("--proposal",
    "benchmarks/zero5-c43-v1/contract-proposal.json");
  const reportPath = option("--report");
  const firstImportPath = option("--import-a");
  const secondImportPath = option("--import-b");
  const variantPaths = options("--variant");
  const out = option("--out");
  if (!reportPath || !firstImportPath || !secondImportPath || !out ||
      variantPaths.length === 0) {
    fail("--report, --import-a, --import-b, --variant, and --out are required");
  }
  const proposal = readJson(proposalPath);
  const c42Contract = readJson(proposal.c42_decision.contract);
  const report = readJson(reportPath);
  validateReleaseReport(report, proposal, c42Contract,
    path.dirname(path.resolve(reportPath)));
  const imports = validateImportPair(readJson(firstImportPath),
    readJson(secondImportPath), report, proposal, c42Contract);
  const entries = variantPaths.map(file => ({
    value: readJson(file),
    sha256: sha256File(file),
  }));
  const selection = selectPilotVariants(entries, report, imports, proposal);
  writeJsonExclusive(path.resolve(out), selection);
  process.stdout.write(`${selection.selected.variant}\n`);
} catch (error) {
  fail(error.message);
}
