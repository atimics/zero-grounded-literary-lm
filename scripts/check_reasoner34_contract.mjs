#!/usr/bin/env node

import fs from "node:fs";

const path =
  "benchmarks/reasoner34-nonmonotonic-planning-v1/aws-contract.json";
const contract = JSON.parse(fs.readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

requireValue(
  contract.schema === "zero.reasoner34_aws_contract.v1",
  "unexpected contract schema",
);
requireValue(contract.version === "(3,3,2)", "unexpected version");
requireValue(contract.authorized === false, "sealed run must stay unauthorized");
requireValue(
  contract.authorization.approval_id === null,
  "unauthorized contract cannot have an approval id",
);
requireValue(
  JSON.stringify(contract.seal.training_gates) === "[1,2,3]" &&
    JSON.stringify(contract.seal.development_gates) === "[4]" &&
    JSON.stringify(contract.seal.sealed_gates) === "[5,6,7]" &&
    contract.seal.sealed_worlds === 5880,
  "world split changed",
);
requireValue(
  contract.seal.local_execution_forbidden === true &&
    contract.seal.retries_for_scientific_failure === 0 &&
    contract.seal.tuning_after_open === false,
  "seal policy changed",
);
requireValue(
  /^[0-9a-f]{40}$/.test(contract.source.base_commit) &&
    /^[0-9a-f]{40}$/.test(contract.source.implementation_commit),
  "source commits must be frozen hashes",
);
requireValue(
  contract.execution.instance_type === "t3.micro" &&
    contract.execution.instance_count === 1 &&
    contract.execution.maximum_instance_seconds === 900 &&
    contract.execution.maximum_ec2_usd === 0.003 &&
    contract.execution.single_execution_lock === true &&
    contract.execution.automatic_termination === true,
  "execution ceiling changed",
);
requireValue(
  contract.commands.development_gate === "./reasoner34 --self-test" &&
    contract.commands.sealed_execution ===
      "./reasoner34 sealed-run result.json",
  "commands changed",
);

console.log("Reasoner (3,3,2) unauthorized sealed contract passed");
