import crypto from "node:crypto";
import fs from "node:fs";

const path = "benchmarks/reasoner40-active-representation-v1/aws-contract.json";
const contract = JSON.parse(fs.readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner 4.0 contract: ${message}`);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

requireValue(contract.schema === "zero.reasoner40_aws_contract.v1", "schema");
requireValue(
  contract.experiment === "reasoner40-active-representation-v1",
  "experiment",
);
requireValue(contract.version === "4.0", "version");
requireValue(contract.authorized === false, "sealed run must stay locked");
requireValue(contract.authorization.approved_by === null, "approver must be null");
requireValue(contract.authorization.approved_at === null, "approval date must be null");
requireValue(contract.authorization.approval_id === null, "approval ID must be null");
requireValue(contract.seal.adapter_programs === 134, "sealed adapters");
requireValue(contract.seal.familiar_laws === 6, "familiar laws");
requireValue(contract.seal.episodes === 6432, "sealed episodes");
requireValue(contract.seal.minimum_dimension === 9, "minimum dimension");
requireValue(contract.seal.maximum_dimension === 12, "maximum dimension");
requireValue(contract.seal.opaque_probe_orders === 2, "opaque probe orders");
requireValue(contract.seal.adapter_depth === 3, "adapter depth");
requireValue(contract.seal.retry === false, "seal retry");
requireValue(contract.frozen_core.version === "(3,9)", "frozen core version");
requireValue(
  contract.frozen_core.development_digest === "c16b44a0ab50c456",
  "frozen core development digest",
);
requireValue(
  sha256("reasoner310.c") === contract.frozen_core.implementation_sha256,
  "frozen reasoner310.c hash",
);
requireValue(
  sha256("reasoner310.h") === contract.frozen_core.header_sha256,
  "frozen reasoner310.h hash",
);
requireValue(contract.source.implementation_commit === null, "source commit must be unset");
requireValue(contract.source.bundle_sha256 === null, "bundle hash must be unset");
requireValue(contract.source.bundle_bytes === null, "bundle size must be unset");
requireValue(contract.source.destination === null, "bundle destination must be unset");
requireValue(contract.execution.enabled === false, "cloud execution must be disabled");
requireValue(contract.execution.region === null, "region must be unset");
requireValue(contract.execution.instance_type === null, "instance type must be unset");
requireValue(
  contract.execution.maximum_instance_seconds === null,
  "time cap must be unset",
);
requireValue(contract.execution.maximum_ec2_usd === null, "EC2 cap must be unset");
requireValue(
  contract.execution.maximum_total_run_usd === null,
  "total cap must be unset",
);
requireValue(contract.execution.retry === false, "execution retry");
requireValue(
  contract.execution.instance_initiated_shutdown_behavior === "terminate",
  "automatic termination",
);
requireValue(contract.result.binary === "reasoner40", "binary");
requireValue(contract.result.make_target === "reasoner40", "make target");
requireValue(
  contract.result.schema === "zero.reasoner40_active_representation.v1",
  "result schema",
);

console.log("Reasoner 4.0 locked active-representation contract passed");
