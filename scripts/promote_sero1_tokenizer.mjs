#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SOURCE = "build/sero-latent-v1/static-byte-bpe.json";
const DESTINATION = "tokenizers/sero1-byte-bpe-4096.json";
const CONTRACT = "tokenizers/sero1-tokenizer.json";
const EXPECTED = "59d13ac8133835e85b3414df5ec06c9145c860ceb1e7cc65efc90f50acc7caf1";

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
assert(contract.schema === "sero.tokenizer_release.v1", "wrong Sero 1 tokenizer contract");
assert(contract.artifact.sha256 === EXPECTED, "contract tokenizer digest drifted");
assert(contract.vocabulary_size === 4096 && contract.lossless_bytes,
  "contract no longer names the frozen lossless 4,096-entry tokenizer");
if (!process.argv.includes("--check")) {
  assert(fs.existsSync(SOURCE), `missing measured source artifact ${SOURCE}`);
  assert(digest(SOURCE) === EXPECTED, "measured tokenizer source digest drifted");
  fs.mkdirSync(path.dirname(DESTINATION), { recursive: true });
  if (!fs.existsSync(DESTINATION)) fs.copyFileSync(SOURCE, DESTINATION);
}

assert(fs.existsSync(DESTINATION), `missing canonical tokenizer ${DESTINATION}`);
assert(digest(DESTINATION) === EXPECTED, "canonical Sero 1 tokenizer digest drifted");

console.log(`Sero 1 tokenizer locked: ${EXPECTED}`);
