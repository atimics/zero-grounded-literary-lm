#!/usr/bin/env node

import fs from "node:fs";

const contract = JSON.parse(
  fs.readFileSync(
    "benchmarks/reasoner35-joint-substrate-v1/aws-contract.json",
    "utf8",
  ),
);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

requireValue(contract.schema === "zero.reasoner35_aws_contract.v1", "schema");
requireValue(contract.version === "(3,4)", "version");
requireValue(contract.authorized === false, "sealed run must stay locked");
requireValue(contract.authorization.approval_id === null, "approval must be null");
requireValue(contract.seal.planning_worlds === 40320, "planning seal");
requireValue(
  contract.seal.composition_programs === 63 &&
    contract.seal.composition_relabelings === 252,
  "composition seal",
);
requireValue(
  contract.seal.witness_programs === 4095 &&
    contract.seal.all_nearest_repair_choices === true,
  "witness seal",
);
requireValue(
  contract.seal.local_execution_forbidden === true &&
    contract.seal.retries_for_scientific_failure === 0 &&
    contract.seal.tuning_after_open === false,
  "seal policy",
);
requireValue(
  contract.source.implementation_commit ===
    "1e57af2da83a76ea0fba0046b8a16fc6a9a3cda8",
  "implementation commit",
);
requireValue(
  contract.execution.instance_type === "t3.micro" &&
    contract.execution.maximum_instance_seconds === 1800 &&
    contract.execution.maximum_ec2_usd === 0.006 &&
    contract.execution.automatic_termination === true,
  "execution cap",
);

console.log("Reasoner (3,4) locked cloud contract passed");
