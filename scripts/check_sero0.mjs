#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(args, expected = 0) {
  const result = spawnSync("./sero_tokenizer", args, { encoding: "utf8" });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}

const contract = JSON.parse(fs.readFileSync("sero0-contract.json", "utf8"));
assert.equal(contract.schema, "sero.model_lineage.v1");
assert.equal(contract.model, "sero-0");
assert.equal(contract.tokenizer.vocabulary_size, 264);
assert.equal(contract.tokenizer.first_learned_merge_id, 264);
assert.equal(contract.architecture.parameters, 4887808);
assert.equal(crypto.createHash("sha256").update(fs.readFileSync("literary_lm.c")).digest("hex"),
  "5f4c47e0fedcc0f96d5eafcd8f45f6bfc4808a1d1af7434cb188693449ff53e3",
  "historical trainer implementation drifted");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sero0-check-"));
try {
  const vocabA = path.join(temporary, "a.sero");
  const vocabB = path.join(temporary, "b.sero");
  const input = path.join(temporary, "input.bin");
  const tokensA = path.join(temporary, "a.tok");
  const tokensB = path.join(temporary, "b.tok");
  const decoded = path.join(temporary, "decoded.bin");
  const fixture = Buffer.concat([
    Buffer.from(Array.from({ length: 256 }, (_, index) => index)),
    Buffer.from("Sero exact UTF-8: Καλημέρα 世界 🜁\n", "utf8"),
    Buffer.from([0xc0, 0xaf, 0xed, 0xa0, 0x80, 0xff]),
  ]);
  fs.writeFileSync(input, fixture);
  run(["init", "--vocab", vocabA]);
  run(["init", "--vocab", vocabB]);
  assert.deepEqual(fs.readFileSync(vocabA), fs.readFileSync(vocabB),
    "Sero 0 artifacts are not deterministic");
  const inspected = JSON.parse(run(["inspect", "--vocab", vocabA]).stdout);
  assert.equal(inspected.vocab_size, 264);
  assert.equal(inspected.merge_count, 0);
  run(["encode", "--vocab", vocabA, "--text", input, "--out", tokensA]);
  run(["encode", "--vocab", vocabB, "--text", input, "--out", tokensB]);
  assert.deepEqual(fs.readFileSync(tokensA), fs.readFileSync(tokensB),
    "Sero 0 tokenization is not deterministic");
  const tokenBytes = fs.readFileSync(tokensA);
  for (let offset = 0; offset < tokenBytes.length; offset += 2) {
    const token = tokenBytes.readUInt16LE(offset);
    assert.ok(token < 1 || token > 7, "raw input collided with channel token");
    assert.notEqual(token, 256, "standalone input emitted document token");
  }
  run(["decode", "--vocab", vocabA, "--tokens", tokensA, "--out", decoded]);
  assert.deepEqual(fs.readFileSync(decoded), fixture, "Sero 0 roundtrip changed bytes");
  fs.writeFileSync(tokensA, Buffer.from([1, 0]));
  const rejected = run(["decode", "--vocab", vocabA, "--tokens", tokensA, "--out", decoded], 1);
  assert.match(rejected.stderr, /structural token/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("Sero 0 tokenizer contract passed");
