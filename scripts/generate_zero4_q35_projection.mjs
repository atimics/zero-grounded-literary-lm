#!/usr/bin/env node
// Freeze the Q3.5 sparse random-feature projection artifact.
//
// The projection is the only frozen representation in the probe. It is
// generated here, once, and pinned by SHA-256 in the contract. The C probe
// loads these exact bytes; it never regenerates them.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SEED_STRING = "zero4-q35-sparse-features-v1";
const EXPANSION = 6144;
const INPUT = 1536;
const DENSITY_DENOMINATOR = 10; // nonzero probability 1/10

function fnv1a(text) {
  let hash = 2166136261 >>> 0;
  for (const character of Buffer.from(text, "utf8")) {
    hash ^= character;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function xorshift32(state) {
  let value = state >>> 0;
  value ^= value << 13; value >>>= 0;
  value ^= value >>> 17;
  value ^= value << 5; value >>>= 0;
  return value >>> 0;
}

function main() {
  const output = process.argv[2] ?? "benchmarks/zero4-q35-sparse-probe-v1/projection.bin";
  let state = fnv1a(SEED_STRING);
  if (state === 0) state = 2463534242 >>> 0;
  const bytes = Buffer.alloc(EXPANSION * INPUT);
  let nonzeros = 0, positives = 0;
  for (let index = 0; index < bytes.length; ++index) {
    state = xorshift32(state);
    if (state % DENSITY_DENOMINATOR !== 0) { bytes[index] = 0; continue; }
    state = xorshift32(state);
    const value = (state & 1) === 1 ? 1 : -1;
    bytes.writeInt8(value, index);
    ++nonzeros; if (value === 1) ++positives;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  console.log(JSON.stringify({
    schema: "zero.zero4_q35_projection_manifest.v1",
    seed_string: SEED_STRING,
    expansion: EXPANSION,
    input: INPUT,
    density: `1/${DENSITY_DENOMINATOR}`,
    nonzero_entries: nonzeros,
    positive_entries: positives,
    negative_entries: nonzeros - positives,
    bytes: bytes.length,
    sha256: digest,
    path: output,
  }, null, 2));
}

main();
