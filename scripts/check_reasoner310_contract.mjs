import fs from "node:fs";

const path = "benchmarks/reasoner310-active-law-v1/aws-contract.json";
const contract = JSON.parse(fs.readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner (3,9) contract: ${message}`);
}

requireValue(contract.schema === "zero.reasoner310_aws_contract.v1", "schema");
requireValue(contract.experiment === "reasoner310-active-law-v1", "experiment");
requireValue(contract.version === "(3,9)", "version");
requireValue(contract.authorized === false, "sealed run must stay locked");
requireValue(contract.authorization.approved_by === null, "approver must be null");
requireValue(contract.authorization.approved_at === null, "approval date must be null");
requireValue(contract.authorization.approval_id === null, "approval ID must be null");
requireValue(contract.seal.canonical_target_programs === 31, "sealed targets");
requireValue(contract.seal.episodes === 744, "sealed episodes");
requireValue(contract.seal.action_calls === 2232, "sealed action calls");
requireValue(contract.seal.minimum_dimension === 9, "minimum dimension");
requireValue(contract.seal.maximum_dimension === 12, "maximum dimension");
requireValue(contract.seal.variants === 6, "sealed variants");
requireValue(contract.seal.coordinate_orders === 6, "coordinate orders");
requireValue(contract.seal.terms_per_target === 3, "target terms");
requireValue(contract.seal.retry === false, "seal retry");
requireValue(
  contract.source.implementation_commit ===
    "57fe18ebd96dd82ed9cf9c775cb24819a62b8d86",
  "source commit",
);
requireValue(
  contract.source.bundle_sha256 ===
    "30ffa61a3c68b1ca8daefe15329f37f0f5f025cbb8b6e26b0a72c8b842a6f574",
  "bundle hash",
);
requireValue(contract.source.bundle_bytes === 41602, "bundle size");
requireValue(
  contract.source.destination ===
    "s3://zero-training-022118847419/experiments/reasoner310-active-law-v1/source/57fe18ebd96dd82ed9cf9c775cb24819a62b8d86.tar.gz",
  "destination",
);
requireValue(contract.execution.region === "us-east-1", "region");
requireValue(contract.execution.instance_type === "t3.micro", "instance type");
requireValue(contract.execution.maximum_instance_seconds === 1800, "time cap");
requireValue(contract.execution.maximum_ec2_usd === 0.006, "EC2 cap");
requireValue(contract.execution.maximum_total_run_usd === 0.01, "total cap");
requireValue(contract.execution.retry === false, "execution retry");
requireValue(
  contract.execution.instance_initiated_shutdown_behavior === "terminate",
  "automatic termination",
);
requireValue(contract.result.binary === "reasoner310", "binary");
requireValue(contract.result.make_target === "reasoner310", "make target");
requireValue(
  contract.result.schema === "zero.reasoner310_active_law.v1",
  "result schema",
);

console.log("Reasoner (3,9) locked frozen-source cloud contract passed");
