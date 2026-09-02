#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const supportedSchemas = new Set([
  "zero.ht1_mergetree_contract.v1",
  "zero.ht2_blockstate_contract.v1",
  "zero.ht3_answerroot_contract.v1",
]);

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= process.argv.length) fail(`missing value for ${name}`);
  return process.argv[index + 1];
}

if (process.argv.includes("--self-test")) {
  if (supportedSchemas.size !== 3) fail("supported contract set changed");
  process.stdout.write("ZERO.5 hierarchical tokenization launcher self-test passed\n");
  process.exit(0);
}

const requestedContract = option("--contract");
if (!requestedContract) fail("pass --contract with one frozen experiment contract");

const contractPath = path.resolve(requestedContract);
if (!fs.existsSync(contractPath)) fail(`contract is missing: ${requestedContract}`);

let contract;
try {
  contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
} catch (error) {
  fail(`contract cannot be read: ${error.message}`);
}

if (!supportedSchemas.has(contract.schema))
  fail("contract is not part of the hierarchical tokenization series");
if (contract.authorized !== true || contract.ilxyr?.run_authorized !== true)
  fail(`${contract.experiment} training is not authorized`);
if (contract.implementation?.status !== "ready" ||
    contract.implementation?.implementation_authorized !== true)
  fail(`${contract.experiment} implementation is not ready or authorized`);

fail(`${contract.experiment} has no bound trainer; freeze implementation before use`);
