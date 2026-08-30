#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) { throw new Error(message); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function atomicWrite(file, data) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

if (process.argv.length !== 3) {
  fail("usage: materialize_zero4_q22_shared_task.mjs GENERATED_DIRECTORY");
}

const outputDirectory = path.resolve(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(outputDirectory, "manifest.json"), "utf8"));
if (manifest.seed !== 5 || manifest.request_mode !== "operation" ||
    manifest.records?.train !== 9500 || manifest.records?.promotion !== 500) {
  fail("generated Q22 corpus does not match the shared-task settings");
}

const source = path.join(outputDirectory, manifest.files?.jsonl?.path ?? "");
if (sha256(source) !== manifest.files?.jsonl?.sha256) fail("canonical Q22 JSONL hash mismatch");
const lines = fs.readFileSync(source, "utf8").trim().split("\n");
const training = lines.filter((line) => JSON.parse(line).split === "train");
if (training.length !== manifest.records.train) fail("canonical Q22 training split mismatch");

atomicWrite(path.join(outputDirectory, "quantity-request.train.jsonl"), `${training.join("\n")}\n`);
