import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

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
requireValue(contract.authorized === true, "sealed run authorization");
requireValue(contract.authorization.approved_by === "ratimics", "approver");
requireValue(contract.authorization.approved_at === "2026-09-01", "approval date");
requireValue(
  contract.authorization.approval_id ===
    "reasoner40-active-representation-2026-09-01-v1",
  "approval ID",
);
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
const sourceCommit = "73b721a00f8e5737cf0fcfb47b14c90b1e832e70";
const sourceFiles = [
  "Makefile",
  "reasoner0.c",
  "reasoner0.h",
  "reasoner310.c",
  "reasoner310.h",
  "reasoner40.c",
  "reasoner40.h",
  "reasoner40_cli.c",
];
const archive = spawnSync(
  "git",
  ["archive", "--format=tar.gz", sourceCommit, ...sourceFiles],
  { encoding: null, maxBuffer: 1024 * 1024 },
);
requireValue(archive.status === 0, "frozen source archive generation");
const bundleSha256 = crypto
  .createHash("sha256")
  .update(archive.stdout)
  .digest("hex");
requireValue(contract.source.implementation_commit === sourceCommit, "source commit");
requireValue(
  contract.source.bundle_sha256 === bundleSha256 &&
    bundleSha256 ===
      "06432af1ef731d637f8fb09a2aaf1d9b1929fd34a2cba40ebae5db6a7fb5afe9",
  "bundle hash",
);
requireValue(
  contract.source.bundle_bytes === archive.stdout.length &&
    archive.stdout.length === 50211,
  "bundle size",
);
requireValue(
  contract.source.destination ===
    "s3://zero-training-022118847419/experiments/reasoner40-active-representation-v1/source/73b721a00f8e5737cf0fcfb47b14c90b1e832e70-06432af1ef731d637f8fb09a2aaf1d9b1929fd34a2cba40ebae5db6a7fb5afe9.tar.gz",
  "bundle destination",
);
requireValue(contract.execution.enabled === true, "cloud execution enabled");
requireValue(contract.execution.region === "us-east-1", "region");
requireValue(contract.execution.image_id === "ami-0d7f022123f8ff19d", "image");
requireValue(contract.execution.instance_type === "t3.micro", "instance type");
requireValue(contract.execution.subnet_id === "subnet-f45220bc", "subnet");
requireValue(
  contract.execution.security_group_id === "sg-03636a7f90a9b8b17",
  "security group",
);
requireValue(
  contract.execution.instance_profile === "zero-training-ec2",
  "instance profile",
);
requireValue(
  contract.execution.training_bucket === "zero-training-022118847419",
  "training bucket",
);
requireValue(contract.execution.maximum_instance_seconds === 900, "time cap");
requireValue(contract.execution.maximum_ec2_usd === 0.003, "EC2 cap");
requireValue(contract.execution.maximum_total_run_usd === 0.01, "total cap");
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
requireValue(
  contract.result.summary_schema === "zero.reasoner40_sealed_summary.v1",
  "summary schema",
);
requireValue(contract.price_evidence.usd_per_hour === 0.0104, "hourly price");
requireValue(contract.price_evidence.checked_at === "2026-09-01", "price date");
requireValue(
  (contract.execution.maximum_instance_seconds *
    contract.price_evidence.usd_per_hour) /
    3600 <=
    contract.execution.maximum_ec2_usd,
  "time and cost caps disagree",
);

console.log("Reasoner 4.0 authorized frozen-source cloud contract passed");
