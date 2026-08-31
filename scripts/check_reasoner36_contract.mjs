import fs from "node:fs";

const path = "benchmarks/reasoner36-task-blind-tools-v1/aws-contract.json";
const contract = JSON.parse(fs.readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Reasoner (3,5) contract: ${message}`);
}

requireValue(contract.schema === "zero.reasoner36_aws_contract.v1", "schema");
requireValue(contract.experiment === "reasoner36-task-blind-tools-v1", "experiment");
requireValue(contract.version === "(3,5)", "version");
requireValue(contract.authorized === true, "sealed run must stay authorized");
requireValue(
  contract.authorization.approved_by === "ratimics" &&
    contract.authorization.approved_at === "2026-08-30" &&
    contract.authorization.approval_id === "reasoner36-next-set-2026-08-30-v1",
  "approval",
);
requireValue(contract.seal.episodes === 2592, "sealed episode count");
requireValue(contract.seal.single_domain_episodes === 864, "single-domain count");
requireValue(contract.seal.mixed_domain_episodes === 1728, "mixed-domain count");
requireValue(contract.seal.stage_handle_permutations === 15552, "permutation count");
requireValue(contract.seal.retry === false, "no retry");
requireValue(
  contract.source.implementation_commit === "b26bd62ee11dba7341d227c2c4cb1f2a2568da65",
  "source commit",
);
requireValue(
  contract.source.bundle_sha256 ===
    "a34fb5827ee1740fc39e1e161b64512008a52b9a10219eb9844e8c4f2a737d4e",
  "bundle hash",
);
requireValue(contract.source.bundle_bytes === 37038, "bundle size");
requireValue(
  contract.source.destination ===
    "s3://zero-training-022118847419/experiments/reasoner36-task-blind-tools-v1/source/b26bd62ee11dba7341d227c2c4cb1f2a2568da65.tar.gz",
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
requireValue(contract.result.binary === "reasoner36", "binary");
requireValue(contract.result.make_target === "reasoner36", "make target");
requireValue(
  contract.result.schema === "zero.reasoner36_task_blind_tools.v1",
  "result schema",
);

console.log("Reasoner (3,5) authorized cloud contract passed");
