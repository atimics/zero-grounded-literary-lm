import fs from "node:fs";

const path = "benchmarks/reasoner38-raw-observation-v1/aws-contract.json";
const contract = JSON.parse(fs.readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner (3,7) contract: ${message}`);
}

requireValue(contract.schema === "zero.reasoner38_aws_contract.v1", "schema");
requireValue(contract.experiment === "reasoner38-raw-observation-v1", "experiment");
requireValue(contract.version === "(3,7)", "version");
requireValue(contract.authorized === false, "sealed run must stay locked");
requireValue(contract.authorization.approved_by === null, "approver must be null");
requireValue(contract.authorization.approved_at === null, "approval date must be null");
requireValue(contract.authorization.approval_id === null, "approval id must be null");
requireValue(contract.seal.episodes === 15552, "sealed episodes");
requireValue(contract.seal.individual_episodes === 5184, "individual episodes");
requireValue(contract.seal.mixed_episodes === 10368, "mixed episodes");
requireValue(contract.seal.coordinate_permutations === 93312, "coordinate permutations");
requireValue(contract.seal.minimum_dimension === 6, "minimum dimension");
requireValue(contract.seal.maximum_dimension === 8, "maximum dimension");
requireValue(contract.seal.minimum_stages === 5, "minimum stages");
requireValue(contract.seal.maximum_stages === 7, "maximum stages");
requireValue(contract.seal.handle_orders === 4, "handle orders");
requireValue(contract.seal.coordinate_orders === 4, "coordinate orders");
requireValue(contract.seal.retry === false, "seal retry");
requireValue(
  contract.source.implementation_commit === "8e3212a9770e4514f5f2b1c465c1243c29062cd6",
  "source commit",
);
requireValue(
  contract.source.bundle_sha256 ===
    "95e2c42ec5fcb49635c409be0b4d7eed4022111a99904c2aed65c3b5e01c2bdf",
  "bundle hash",
);
requireValue(contract.source.bundle_bytes === 38098, "bundle size");
requireValue(
  contract.source.destination ===
    "s3://zero-training-022118847419/experiments/reasoner38-raw-observation-v1/source/8e3212a9770e4514f5f2b1c465c1243c29062cd6.tar.gz",
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
requireValue(contract.result.binary === "reasoner38", "binary");
requireValue(contract.result.make_target === "reasoner38", "make target");
requireValue(contract.result.schema === "zero.reasoner38_raw_observation.v1", "result schema");

console.log("Reasoner (3,7) frozen, locked raw-observation cloud contract passed");
