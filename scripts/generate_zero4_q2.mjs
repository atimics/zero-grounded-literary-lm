#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TOK = Object.freeze({ channel: 1, message: 2, reply: 3, end: 4, record: 5, target: 6, summary: 7 });
const MAX_RECORD_TOKENS = 500;

class Rng {
  constructor(seed) { this.state = (seed >>> 0) || 1; }
  next() { let x = this.state; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.state = x >>> 0; return this.state; }
  int(minimum, maximum) { return minimum + (this.next() % (maximum - minimum + 1)); }
  pick(values) { return values[this.next() % values.length]; }
}

function fail(message) { throw new Error(message); }
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b !== 0) [a, b] = [b, a % b]; return a || 1; }
function rational(numerator, denominator) {
  if (denominator < 0) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  numerator /= divisor; denominator /= divisor;
  return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;
}
function ascii(text) { return [...text].map((character) => { const code = character.charCodeAt(0); return code >= 32 && code < 127 ? code : 32; }); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function atomicWrite(file, data) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, data); fs.renameSync(temporary, file); }
function seedFor(base, split, index) { return crypto.createHash("sha256").update(`${base}:quantity-request:${split}:${index}`).digest().readUInt32LE(0) || 1; }

function makeRecord(split, index, rng) {
  const base = {
    schema: "zero.faculty_request.v1",
    id: `quantity-request/${split}/${String(index).padStart(6, "0")}`,
    domain: "quantity",
    curriculum: "quantity-request-v1",
    split,
    split_unit: `quantity-request/${split}/${index}`,
    authority: "kernel",
    source: { kind: "synthetic", generator: "generate_zero4_q2.mjs", version: 1, seed: index },
    previous_summary: "quantity channel has no prior committed result"
  };
  const mode = index % 5;
  if (mode === 0) {
    const a = rng.int(-999, 999), b = rng.int(-999, 999), value = a + b;
    return { ...base, task: "add", input: `add ${a} ${b}`, request: `quantity.add ${a} ${b}`, artifact: `result ${value}`, summary: `kernel committed result ${value}` };
  }
  if (mode === 1) {
    const a = rng.int(-99, 99), b = rng.int(-99, 99), value = a * b;
    return { ...base, task: "multiply", input: `multiply ${a} ${b}`, request: `quantity.multiply ${a} ${b}`, artifact: `result ${value}`, summary: `kernel committed result ${value}` };
  }
  if (mode === 2) {
    const a = rng.int(-24, 24), b = rng.int(1, 24), c = rng.int(-24, 24), d = rng.int(1, 24);
    const value = rational(a * d + c * b, b * d);
    return { ...base, task: "add-rational", input: `add-rational ${a}/${b} ${c}/${d}`, request: `quantity.add-rational ${a}/${b} ${c}/${d}`, artifact: `result ${value}`, summary: `kernel committed result ${value}` };
  }
  if (mode === 3) {
    const value = rng.int(1, 999), conversion = rng.pick(["m-to-cm", "cm-to-mm", "kg-to-g"]);
    const factor = conversion === "m-to-cm" ? 100 : conversion === "cm-to-mm" ? 10 : 1000;
    const unit = conversion === "m-to-cm" ? "cm" : conversion === "cm-to-mm" ? "mm" : "g";
    const artifact = `result ${value * factor} ${unit}`;
    return { ...base, task: "convert", input: `convert ${value} ${conversion}`, request: `quantity.convert ${value} ${conversion}`, artifact, summary: `kernel committed ${artifact}` };
  }
  const coefficient = rng.int(1, 24), x = rng.int(-99, 99), offset = rng.int(-99, 99), result = coefficient * x + offset;
  return { ...base, task: "solve-linear", input: `solve ${coefficient}*x+${offset}=${result}`, request: `quantity.solve-linear ${coefficient} ${offset} ${result}`, artifact: `x ${x}`, summary: `kernel committed x ${x}` };
}

function check(record) {
  let match;
  if ((match = /^add (-?\d+) (-?\d+)$/.exec(record.input))) {
    return record.request === `quantity.add ${match[1]} ${match[2]}` && record.artifact === `result ${Number(match[1]) + Number(match[2])}`;
  }
  if ((match = /^multiply (-?\d+) (-?\d+)$/.exec(record.input))) {
    return record.request === `quantity.multiply ${match[1]} ${match[2]}` && record.artifact === `result ${Number(match[1]) * Number(match[2])}`;
  }
  if ((match = /^add-rational (-?\d+)\/(\d+) (-?\d+)\/(\d+)$/.exec(record.input))) {
    const value = rational(Number(match[1]) * Number(match[4]) + Number(match[3]) * Number(match[2]), Number(match[2]) * Number(match[4]));
    return record.request === `quantity.add-rational ${match[1]}/${match[2]} ${match[3]}/${match[4]}` && record.artifact === `result ${value}`;
  }
  if ((match = /^convert (\d+) (m-to-cm|cm-to-mm|kg-to-g)$/.exec(record.input))) {
    const factor = match[2] === "m-to-cm" ? 100 : match[2] === "cm-to-mm" ? 10 : 1000;
    const unit = match[2] === "m-to-cm" ? "cm" : match[2] === "cm-to-mm" ? "mm" : "g";
    return record.request === `quantity.convert ${match[1]} ${match[2]}` && record.artifact === `result ${Number(match[1]) * factor} ${unit}`;
  }
  if ((match = /^solve (-?\d+)\*x\+(-?\d+)=(-?\d+)$/.exec(record.input))) {
    const x = (Number(match[3]) - Number(match[2])) / Number(match[1]);
    return Number.isInteger(x) && record.request === `quantity.solve-linear ${match[1]} ${match[2]} ${match[3]}` && record.artifact === `x ${x}`;
  }
  return false;
}

function outputText(record) { return `@request ${record.model_request ?? record.request} @close`; }
function encode(record) {
  const tokens = [TOK.channel, "Q".charCodeAt(0), TOK.summary, ...ascii(record.previous_summary), TOK.end, TOK.message, "U".charCodeAt(0), ...ascii(record.input), TOK.end, TOK.message, "Z".charCodeAt(0), TOK.reply, "U".charCodeAt(0), TOK.target, ...ascii(outputText(record)), TOK.end, TOK.record];
  if (tokens.length > MAX_RECORD_TOKENS) fail(`${record.id} exceeds context`);
  return tokens;
}
function tokenBuffer(records) {
  const encoded = records.map(encode), count = encoded.reduce((sum, row) => sum + row.length, 0), buffer = Buffer.allocUnsafe(count * 2);
  let offset = 0;
  for (const row of encoded) for (const token of row) { buffer.writeUInt16LE(token, offset); offset += 2; }
  return { buffer, tokens: count };
}

function generate(out, requested, seed, requestMode) {
  const counts = { train: Math.floor(requested * 0.95), validation: requested - Math.floor(requested * 0.95), promotion: Math.max(20, Math.floor(requested * 0.05)) };
  const records = [];
  for (const [split, count] of Object.entries(counts)) {
    for (let index = 0; index < count; ++index) {
      const record = makeRecord(split, index, new Rng(seedFor(seed, split, index)));
      if (requestMode === "operation") {
        record.schema = "zero.faculty_operation_request.v1";
        record.curriculum = "quantity-operation-request-v1";
        record.model_request = record.request.split(" ", 1)[0];
      }
      if (!check(record) || record.summary !== `kernel committed ${record.artifact}`) fail(`checker rejected ${record.id}`);
      encode(record); records.push(record);
    }
  }
  const trainValidation = records.filter((record) => record.split !== "promotion"), tokenized = tokenBuffer(trainValidation);
  const files = {
    jsonl: path.join(out, "quantity-request.jsonl"),
    tokens: path.join(out, "quantity-request.tok"),
    preview: path.join(out, "quantity-request.PREVIEW.txt"),
    sentinel: path.join(out, "quantity-request.sentinel.tsv"),
    public: path.join(out, "quantity-request.public.tsv"),
    promotion: path.join(out, "quantity-request.promotion.tsv")
  };
  atomicWrite(files.jsonl, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  atomicWrite(files.tokens, tokenized.buffer);
  atomicWrite(files.preview, `${records.filter((record) => record.split === "train").slice(0, 16).map((record) => `[${record.input}] => ${outputText(record)} => ${record.artifact}\n`).join("")}`);
  const evaluationHeader = requestMode === "operation"
    ? "id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary"
    : "id\tdomain\tprevious_summary\tinput\trequest\tartifact\tsummary";
  const evaluationRow = (record) => requestMode === "operation"
    ? [record.id, record.domain, record.previous_summary, record.input, record.model_request, record.request, record.artifact, record.summary].join("\t")
    : [record.id, record.domain, record.previous_summary, record.input, record.request, record.artifact, record.summary].join("\t");
  const validationRecords = records.filter((record) => record.split === "validation");
  const sentinelRows = validationRecords.slice(0, 64).map(evaluationRow);
  const publicRows = validationRecords.map(evaluationRow);
  const promotionRows = records.filter((record) => record.split === "promotion").map(evaluationRow);
  atomicWrite(files.sentinel, `${evaluationHeader}\n${sentinelRows.join("\n")}\n`);
  atomicWrite(files.public, `${evaluationHeader}\n${publicRows.join("\n")}\n`);
  atomicWrite(files.promotion, `${evaluationHeader}\n${promotionRows.join("\n")}\n`);
  const manifest = {
    schema: requestMode === "operation" ? "zero.zero4_q21_corpus.v1" : "zero.zero4_q2_corpus.v1",
    generator: "scripts/generate_zero4_q2.mjs", seed, request_mode: requestMode,
    split_policy: "latent task assigned before surface generation; 64-case sentinel and full public validation are drawn only from validation; promotion is disjoint and excluded from all training-time evaluation",
    authority_policy: requestMode === "operation"
      ? "model selects only the operation; controller binds source arguments; deterministic kernel alone emits and commits the artifact"
      : "model emits a bound request; deterministic kernel alone emits and commits the artifact",
    records: counts, channel_tokens: tokenized.tokens,
    files: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, { path: path.basename(file), sha256: sha256(file) }]))
  };
  atomicWrite(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return counts.train + counts.validation + counts.promotion;
}

function checkDirectory(out) {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  const requestMode = manifest.request_mode ?? "full";
  for (const metadata of Object.values(manifest.files)) if (sha256(path.join(out, metadata.path)) !== metadata.sha256) fail(`hash mismatch ${metadata.path}`);
  const records = fs.readFileSync(path.join(out, manifest.files.jsonl.path), "utf8").trim().split("\n").map(JSON.parse);
  const counts = { train: 0, validation: 0, promotion: 0 };
  for (const record of records) {
    const expectedModelRequest = record.request.split(" ", 1)[0];
    if (!check(record) || record.summary !== `kernel committed ${record.artifact}` ||
        (requestMode === "operation" && record.model_request !== expectedModelRequest) ||
        (requestMode === "full" && record.model_request !== undefined)) fail(`invalid ${record.id}`);
    encode(record); counts[record.split] += 1;
  }
  for (const split of Object.keys(counts)) if (counts[split] !== manifest.records[split]) fail(`${split} count mismatch`);
  const sentinel = fs.readFileSync(path.join(out, manifest.files.sentinel.path), "utf8").trim().split("\n");
  const publicValidation = fs.readFileSync(path.join(out, manifest.files.public.path), "utf8").trim().split("\n");
  const promotion = fs.readFileSync(path.join(out, manifest.files.promotion.path), "utf8").trim().split("\n");
  const expectedHeader = requestMode === "operation"
    ? "id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary"
    : "id\tdomain\tprevious_summary\tinput\trequest\tartifact\tsummary";
  if (sentinel[0] !== expectedHeader || sentinel.length - 1 !== Math.min(64, counts.validation)) fail("sentinel TSV mismatch");
  if (publicValidation[0] !== expectedHeader || publicValidation.length - 1 !== counts.validation) fail("public validation TSV mismatch");
  if (promotion[0] !== expectedHeader || promotion.length - 1 !== counts.promotion) fail("promotion TSV mismatch");
  console.log(`ZERO.4-${requestMode === "operation" ? "operation-request" : "Q2"} corpus check: ${records.length} canonical requests, hashes, splits, and exact artifacts passed`);
}

function parseArgs(argv) {
  const options = { out: "corpus/faculty/q2", quantity: 10000, seed: 5, requestMode: "full", check: false };
  for (let index = 2; index < argv.length; ++index) {
    if (argv[index] === "--check") options.check = true;
    else if (["--out", "--quantity", "--seed", "--request-mode"].includes(argv[index]) && index + 1 < argv.length) {
      const key = argv[index++].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = ["out", "requestMode"].includes(key) ? argv[index] : Number(argv[index]);
    } else fail(`unknown or incomplete option ${argv[index]}`);
  }
  if (!Number.isInteger(options.quantity) || options.quantity < 20 || !Number.isInteger(options.seed)) fail("quantity must be >=20 and seed must be an integer");
  if (!["full", "operation"].includes(options.requestMode)) fail("request mode must be full or operation");
  return options;
}

const options = parseArgs(process.argv);
if (options.check) checkDirectory(options.out);
else { fs.mkdirSync(options.out, { recursive: true }); generate(options.out, options.quantity, options.seed, options.requestMode); checkDirectory(options.out); }
