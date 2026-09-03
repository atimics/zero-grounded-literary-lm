#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const trainer = process.env.ZERO5_HT1_BINARY || "./zero5_ht1_mergetree_lm";
const control = process.env.ZERO5_HT1_CONTROL_BINARY || "./zero5_c32_lm_vector_math";
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function run(program, args, expected = 0) {
  const result = spawnSync(program, args, { encoding: "utf8",
    env: { ...process.env, VECLIB_MAXIMUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1", OPENBLAS_DYNAMIC: "0" }, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, expected, `${program}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function checkpoint(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString(), "ZEROLM2\0");
  assert.equal(bytes.readUInt32LE(8), 6);
  const count = bytes.readUInt32LE(36), parameters = [];
  let offset = 64 + 128;
  for (let i = 0; i < count; i++) {
    const cells = Number(bytes.readBigUInt64LE(offset));
    const length = 8 + cells * 12;
    parameters.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  assert.equal(offset, bytes.length);
  return { bytes, parameters, step: bytes.readBigUInt64LE(48),
    rng: bytes.readBigUInt64LE(56), state: bytes.subarray(64, 192) };
}

assert.match(run(trainer, ["--self-test"]), /HT1 MergeTree self-test passed/u);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zero5-ht1-check-"));
const file = name => path.join(directory, name);
try {
  const tokenizer = Buffer.alloc(24 + 248 * 4);
  tokenizer.write("SEROTOK\0");
  [1, 264, 248, 1].forEach((value, i) => tokenizer.writeUInt32LE(value, 8 + i * 4));
  for (let i = 0; i < 248; i++) {
    tokenizer.writeUInt16LE(i === 0 ? 97 : (i === 1 ? 264 : 8 + i % 240), 24 + i * 4);
    tokenizer.writeUInt16LE(i === 1 ? 264 : 98, 26 + i * 4);
  }
  fs.writeFileSync(file("tokenizer.bin"), tokenizer);
  // Exact byte round trip includes NUL, escaped control bytes, and UTF-8 bytes.
  const raw = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    Buffer.from("ababab café 🧪\n")]);
  fs.writeFileSync(file("raw.bin"), raw);
  run("./sero_tokenizer", ["encode", "--vocab", file("tokenizer.bin"),
    "--text", file("raw.bin"), "--out", file("tokens.bin")]);
  run("./sero_tokenizer", ["decode", "--vocab", file("tokenizer.bin"),
    "--tokens", file("tokens.bin"), "--out", file("roundtrip.bin")]);
  assert.deepEqual(fs.readFileSync(file("roundtrip.bin")), raw);

  const context = 8, groups = 10;
  const offsets = [0];
  for (let i = 0; i < groups; i++) offsets.push(offsets.at(-1) + (i % 2 ? 2 : 1));
  const packs = offsets.at(-1);
  const header = Buffer.alloc(72 + 4 + offsets.length * 4);
  header.write("Z5PKV3\0\0");
  [3, 512, context, packs].forEach((value, i) => header.writeUInt32LE(value, 8 + i * 4));
  [packs, packs * 7, packs * 3, packs, packs, packs].forEach((value, i) =>
    header.writeBigUInt64LE(BigInt(value), 24 + i * 8));
  header.writeUInt32LE(groups, 72);
  offsets.forEach((value, i) => header.writeUInt32LE(value, 76 + i * 4));
  const tokens = Buffer.alloc(packs * (context + 1) * 2);
  const classes = Buffer.alloc(packs * context);
  for (let p = 0; p < packs; p++) {
    [97, 264, 265, 98, 1, 257, 0, 256, 99].forEach((token, i) =>
      tokens.writeUInt16LE(token, (p * (context + 1) + i) * 2));
    [1, 2, 3, 1, 4, 1, 1, 0].forEach((value, i) => classes[p * context + i] = value);
  }
  fs.writeFileSync(file("packs.bin"), Buffer.concat([header, tokens, classes]));
  const common = ["--tokenizer", file("tokenizer.bin")];
  run(control, ["--preset", "literary", "--context", "8", "--dim", "8", "--heads", "2", "--layers", "1",
    "--ff", "16", "--vocab", "512", ...common, "--steps", "1",
    "--batch", "1", "--warmup", "1", "--tokens", "0", "--save", file("init.ckpt")]);
  const recipe = [...common, "--packed-train", file("packs.bin"),
    "--packed-validation", file("packs.bin"), "--steps", "10", "--batch", "2",
    "--warmup", "2", "--report", "2", "--validation", "3",
    "--claim-answer-weight", "2.229423406", "--cloze-answer-weight", "5.253416128",
    "--retrieval-answer-weight", "1.429401038", "--run-contract-sha256", "a".repeat(64)];
  for (const workers of [1, 2]) {
    const schedule = [...recipe, "--parallel-batch", String(workers)];
    run(control, ["--init", file("init.ckpt"), ...schedule, "--cosine", "--tokens", "0",
      "--save", file(`control-${workers}.ckpt`)]);
    run(trainer, ["--init", file("init.ckpt"), ...schedule, "--gate-off",
      "--save", file(`off-${workers}.ckpt`)]);
    const base = checkpoint(file(`control-${workers}.ckpt`));
    const off = checkpoint(file(`off-${workers}.ckpt`));
    assert.equal(off.parameters.length, base.parameters.length + 1);
    assert.deepEqual(off.parameters.slice(0, -1), base.parameters,
      `gate-off weights and AdamW state, workers=${workers}`);
    assert.equal(off.rng, base.rng);
    assert.equal(off.step, 10n);
    assert.deepEqual(off.state, base.state, "selection and schedule state identity");
    assert.equal(off.parameters.at(-1).readBigUInt64LE(0), 249n);
    assert(off.parameters.at(-1).subarray(8).every(value => value === 0));
    const identityArgs = checkpoint => ["--init", checkpoint, ...common,
      "--identity-eval", file("packs.bin"), "--validation", "10", "--gate-off"];
    const controlIdentity = JSON.parse(run(trainer,
      identityArgs(file(`control-${workers}.ckpt`))).trim());
    const offIdentity = JSON.parse(run(trainer,
      identityArgs(file(`off-${workers}.ckpt`))).trim());
    assert.equal(controlIdentity.schema, "zero.ht1_identity_eval.v1");
    assert.deepEqual(offIdentity, controlIdentity,
      `gate-off logits and loss digest, workers=${workers}`);
    run(trainer, ["--init", file("init.ckpt"), ...schedule,
      "--save", file(`on-${workers}.ckpt`)]);
    run(trainer, ["--init", file("init.ckpt"), ...schedule, "--max-run-steps", "4",
      "--save", file(`resume-${workers}.ckpt`)]);
    run(trainer, ["--resume", file(`resume-${workers}.ckpt`), ...schedule,
      "--save", file(`resume-${workers}.ckpt`)]);
    assert.deepEqual(fs.readFileSync(file(`resume-${workers}.ckpt`)),
      fs.readFileSync(file(`on-${workers}.ckpt`)), "split-run checkpoint identity");
    const on = checkpoint(file(`on-${workers}.ckpt`));
    assert(on.parameters.at(-1).subarray(8).some(value => value !== 0), "gates learn");
    assert.notEqual(digest(on.parameters[0]), digest(off.parameters[0]),
      "tree treatment changes embeddings");
    const wrong = [...schedule];
    wrong[wrong.indexOf("--run-contract-sha256") + 1] = "b".repeat(64);
    run(trainer, ["--resume", file(`resume-${workers}.ckpt`), ...wrong], 1);
  }
  const score = JSON.parse(run(trainer, ["--init", file("on-2.ckpt"), ...common,
    "--depth-eval", file("packs.bin")]).trim());
  assert.equal(score.schema, "zero.ht1_depth_eval.v1");
  assert.deepEqual(score.bands.map(band => band.targets), [packs * 5, packs, packs]);
  assert.deepEqual(score.bands.map(band => band.raw_bytes), [packs * 3, packs * 2, packs * 4]);
  assert.deepEqual(score.bands.map(band => band.structural_targets), [packs * 2, 0, 0]);
  const corrupt = Buffer.from(tokenizer);
  corrupt.writeUInt16LE(264, 24);
  fs.writeFileSync(file("corrupt.bin"), corrupt);
  run(trainer, ["--init", file("init.ckpt"), "--tokenizer", file("corrupt.bin"),
    "--depth-eval", file("packs.bin")], 1);
  run("node", ["scripts/evaluate_zero5_ht1_mergetree.mjs", "--self-test"]);
  run("node", ["scripts/preflight_zero5_ht1_mergetree.mjs", "--self-test"]);
  process.stdout.write("ZERO.5 HT1 checks passed: byte round trip, ten-update gate-off parity " +
    "(1/2 workers), learned gates, exact restart, depth accounting, evaluator gates\n");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
