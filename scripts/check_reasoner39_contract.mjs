import fs from "node:fs";

const path = "benchmarks/reasoner39-exact-law-v1/aws-contract.json";
const contract = JSON.parse(fs.readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner (3,8) contract: ${message}`);
}

requireValue(contract.schema === "zero.reasoner39_aws_contract.v1", "schema");
requireValue(contract.experiment === "reasoner39-exact-law-v1", "experiment");
requireValue(contract.version === "(3,8)", "version");
requireValue(contract.authorized === false, "sealed run must stay locked");
requireValue(contract.authorization.approved_by === null, "approver must be null");
requireValue(contract.authorization.approved_at === null, "approval date must be null");
requireValue(contract.authorization.approval_id === null, "approval id must be null");
requireValue(contract.seal.episodes === 20736, "sealed episodes");
requireValue(contract.seal.individual_episodes === 6912, "individual episodes");
requireValue(contract.seal.mixed_episodes === 13824, "mixed episodes");
requireValue(contract.seal.coordinate_permutations === 145152, "coordinate permutations");
requireValue(contract.seal.minimum_dimension === 9, "minimum dimension");
requireValue(contract.seal.maximum_dimension === 12, "maximum dimension");
requireValue(contract.seal.minimum_stages === 6, "minimum stages");
requireValue(contract.seal.maximum_stages === 8, "maximum stages");
requireValue(contract.seal.handle_orders === 4, "handle orders");
requireValue(contract.seal.coordinate_orders === 4, "coordinate orders");
requireValue(contract.seal.retry === false, "seal retry");
requireValue(
  contract.source.implementation_commit === "16ef41706023ae4df417bb562490adf3404292fd",
  "source commit",
);
requireValue(
  contract.source.bundle_sha256 ===
    "6cc30df918c77800b49b6599f02e39ea6644590ebb32ccb034b93a9bf8cfdb14",
  "bundle hash",
);
requireValue(contract.source.bundle_bytes === 40342, "bundle size");
requireValue(
  contract.source.destination ===
    "s3://zero-training-022118847419/experiments/reasoner39-exact-law-v1/source/16ef41706023ae4df417bb562490adf3404292fd.tar.gz",
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
requireValue(contract.result.binary === "reasoner39", "binary");
requireValue(contract.result.make_target === "reasoner39", "make target");
requireValue(contract.result.schema === "zero.reasoner39_exact_law.v1", "result schema");

console.log("Reasoner (3,8) frozen, locked exact-law cloud contract passed");
