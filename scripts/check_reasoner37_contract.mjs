import fs from "node:fs";

const path = "benchmarks/reasoner37-language-readout-v1/aws-contract.json";
const contract = JSON.parse(fs.readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner (3,6) contract: ${message}`);
}

requireValue(contract.schema === "zero.reasoner37_aws_contract.v1", "schema");
requireValue(contract.experiment === "reasoner37-language-readout-v1", "experiment");
requireValue(contract.version === "(3,6)", "version");
requireValue(contract.authorized === true, "sealed run must stay authorized");
requireValue(
  contract.authorization.approved_by === "ratimics" &&
    contract.authorization.approved_at === "2026-08-30" &&
    contract.authorization.approval_id === "reasoner37-next-set-2026-08-30-v1",
  "approval",
);
requireValue(contract.prerequisite.experiment === "reasoner36-task-blind-tools-v1", "prerequisite experiment");
requireValue(contract.prerequisite.version === "(3,5)", "prerequisite version");
requireValue(contract.prerequisite.sealed_gate_passed === true, "prerequisite must pass");
requireValue(
  contract.prerequisite.result_sha256 ===
    "9f00ef30e4a815bbcc88683f74a65c39d62358476f8023bc1ce3d293ccbd2597",
  "prerequisite receipt",
);
requireValue(contract.seal.reasoning_episodes === 2592, "reasoning episodes");
requireValue(contract.seal.surface_lexicons === 2, "surface lexicons");
requireValue(contract.seal.language_is_causally_downstream === true, "causal boundary");
requireValue(contract.seal.adversarial_language_control === true, "adversarial control");
requireValue(contract.seal.retry === false, "no retry");
requireValue(
  contract.source.implementation_commit === "06adde505c47802d80148c0b93ff70b2c749034b",
  "source commit",
);
requireValue(
  contract.source.bundle_sha256 ===
    "e43419a197ffd9e38becc30eae22de14a0b534db9b30c3ce34b597328ec76964",
  "bundle hash",
);
requireValue(contract.source.bundle_bytes === 42147, "bundle size");
requireValue(
  contract.source.destination ===
    "s3://zero-training-022118847419/experiments/reasoner37-language-readout-v1/source/06adde505c47802d80148c0b93ff70b2c749034b.tar.gz",
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
requireValue(contract.result.binary === "reasoner37", "binary");
requireValue(contract.result.make_target === "reasoner37", "make target");
requireValue(
  contract.result.schema === "zero.reasoner37_language_readout.v1",
  "result schema",
);

console.log("Reasoner (3,6) authorized downstream cloud contract passed");
