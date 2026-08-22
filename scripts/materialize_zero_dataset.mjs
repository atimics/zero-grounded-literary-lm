#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assert, parseNamedArgs, sha256, sha256File, stableJson, writeJson,
} from "./zero_data_lib.mjs";

function aws(args) {
  const result = spawnSync("aws", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`aws ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

const options = parseNamedArgs(process.argv, {
  dataset_id: "", version: "", digest: "", bucket: "", table: "zero-datasets",
  out: "", region: process.env.AWS_REGION ?? "us-east-1",
});
assert(options.dataset_id && options.version && options.digest && options.bucket && options.out,
  "--dataset-id, --version, --digest, --bucket, and --out are required");
assert(/^[0-9a-f]{64}$/.test(options.digest), "invalid dataset digest");
const output = path.resolve(options.out);
assert(!fs.existsSync(output), `refusing to overwrite ${output}`);
fs.mkdirSync(output, { recursive: true });

const key = JSON.stringify({ dataset_id: { S: options.dataset_id }, version: { S: options.version } });
const catalog = JSON.parse(aws(["dynamodb", "get-item", "--region", options.region,
  "--table-name", options.table, "--consistent-read", "--key", key])).Item;
assert(catalog, "dataset version is absent from the catalog");
assert(catalog.status.S === "ready", "dataset is not ready");
assert(catalog.dataset_digest.S === options.digest, "catalog digest does not match requested digest");
assert(catalog.bucket.S === options.bucket, "catalog bucket does not match requested bucket");
const prefix = catalog.prefix.S;

function download(relative) {
  const destination = path.join(output, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  aws(["s3api", "get-object", "--region", options.region, "--bucket", options.bucket,
    "--key", `${prefix}/${relative}`, destination]);
  return destination;
}

const readyPath = download("READY");
const manifestPath = download("manifest.json");
const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert(ready.dataset_digest === options.digest && manifest.dataset_digest === options.digest,
  "sealed dataset digest does not match request");
assert(ready.manifest_sha256 === sha256File(manifestPath), "manifest binding does not verify");
const { dataset_digest: observed, ...body } = manifest;
assert(sha256(stableJson(body, 0)) === observed, "manifest dataset digest does not verify");

const wanted = new Set(["tokenizer.bpe", "source-registry.json"]);
for (const [splitName, split] of Object.entries(manifest.splits)) {
  wanted.add(`documents/${splitName}.jsonl`);
  for (const source of split.sources) for (const shard of source.shards) wanted.add(shard);
}
for (const relative of [...wanted].sort()) {
  const binding = manifest.artifacts.find((item) => item.path === relative);
  assert(binding, `manifest has no binding for ${relative}`);
  const file = download(relative);
  assert(fs.statSync(file).size === binding.bytes && sha256File(file) === binding.sha256,
    `${relative} failed verification`);
}
writeJson(path.join(output, "training-inputs.json"), {
  schema: "zero.materialized_dataset.v1", dataset_id: manifest.dataset_id,
  version: manifest.version, dataset_digest: manifest.dataset_digest,
  manifest: "manifest.json", tokenizer: "tokenizer.bpe",
  documents: Object.fromEntries(Object.keys(manifest.splits).map((split) =>
    [split, `documents/${split}.jsonl`])), splits: manifest.splits,
});
console.log(`materialized ${manifest.dataset_id}/${manifest.version} at ${output}`);
