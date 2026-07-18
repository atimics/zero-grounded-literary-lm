#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TOK = Object.freeze({ channel: 1, message: 2, reply: 3, end: 4, record: 5, target: 6, summary: 7 });
const CHANNEL_CODE = Object.freeze({ quantity: "Q", geometry: "G", art: "A", protocol: "P" });
const MAX_RECORD_TOKENS = 500;

class Rng {
  constructor(seed) { this.state = (seed >>> 0) || 1; }
  next() {
    let x = this.state;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }
  int(minimum, maximum) { return minimum + (this.next() % (maximum - minimum + 1)); }
  pick(values) { return values[this.next() % values.length]; }
}

function fail(message) { throw new Error(message); }
function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}
function rational(numerator, denominator) {
  if (denominator === 0) fail("zero denominator");
  if (denominator < 0) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  numerator /= divisor; denominator /= divisor;
  return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;
}
function ascii(text) {
  return [...String(text)].map((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code < 127 ? code : 32;
  });
}
function cleanText(text) { return String(text).replace(/[^\x20-\x7e]/g, " "); }
function outputText(record) {
  return `@artifact ${record.artifact} @summary ${record.summary} @close`;
}
function encodeRecord(record) {
  const channelCode = record.channel_code ?? CHANNEL_CODE[record.domain];
  const tokens = [TOK.channel, channelCode.charCodeAt(0), TOK.summary];
  tokens.push(...ascii(record.previous_summary), TOK.end);
  tokens.push(TOK.message, "U".charCodeAt(0), ...ascii(record.input), TOK.end);
  tokens.push(TOK.message, "Z".charCodeAt(0), TOK.reply, "U".charCodeAt(0), TOK.target);
  tokens.push(...ascii(outputText(record)), TOK.end, TOK.record);
  if (tokens.length > MAX_RECORD_TOKENS) fail(`${record.id} has ${tokens.length} tokens`);
  return tokens;
}
function previewRecord(record) {
  return `\n<CHANNEL:${record.channel_code ?? CHANNEL_CODE[record.domain]}>\n<SUMMARY>${record.previous_summary}\n[U ${record.input}]\n[Z>U] => ${outputText(record)}\n<END>\n`;
}
function baseRecord(domain, split, index, task, input, artifact, summary, authority) {
  return {
    schema: "zero.faculty_chunk.v1",
    id: `${domain}/${split}/${String(index).padStart(6, "0")}`,
    domain,
    curriculum: `${domain}-v1`,
    task,
    channel_epoch: 0,
    split,
    split_unit: `${domain}/${split}/${index}`,
    source: { kind: "synthetic", generator: "generate_zero4_faculty.mjs", version: 1, seed: index },
    authority,
    previous_summary: `${domain} channel has no prior committed result`,
    input: cleanText(input),
    artifact: cleanText(artifact),
    summary: cleanText(summary),
    requests: [],
    verification: { status: "valid", checker: `${domain}_check`, checker_version: 1 }
  };
}

function quantityRecord(split, index, rng) {
  const mode = index % 5;
  if (mode === 0) {
    const a = rng.int(-99, 99), b = rng.int(-99, 99);
    return baseRecord("quantity", split, index, "add", `add ${a} ${b}`, `result ${a + b}`, `${a} plus ${b} is ${a + b}`, "kernel");
  }
  if (mode === 1) {
    const a = rng.int(-18, 18), b = rng.int(-18, 18);
    return baseRecord("quantity", split, index, "multiply", `multiply ${a} ${b}`, `result ${a * b}`, `${a} times ${b} is ${a * b}`, "kernel");
  }
  if (mode === 2) {
    const a = rng.int(-12, 12), b = rng.int(1, 12), c = rng.int(-12, 12), d = rng.int(1, 12);
    const value = rational(a * d + c * b, b * d);
    return baseRecord("quantity", split, index, "add-rational", `add-rational ${a}/${b} ${c}/${d}`, `result ${value}`, `the reduced sum is ${value}`, "kernel");
  }
  if (mode === 3) {
    const value = rng.int(1, 200), unit = rng.pick(["m-to-cm", "cm-to-mm", "kg-to-g"]);
    const factor = unit === "m-to-cm" ? 100 : unit === "cm-to-mm" ? 10 : 1000;
    const outputUnit = unit === "m-to-cm" ? "cm" : unit === "cm-to-mm" ? "mm" : "g";
    return baseRecord("quantity", split, index, "convert-unit", `convert ${value} ${unit}`, `result ${value * factor} ${outputUnit}`, `the exact unit conversion is ${value * factor} ${outputUnit}`, "kernel");
  }
  const coefficient = rng.int(1, 12), x = rng.int(-20, 20), offset = rng.int(-20, 20), result = coefficient * x + offset;
  return baseRecord("quantity", split, index, "solve-linear", `solve ${coefficient}*x+${offset}=${result}`, `x ${x}`, `the unique integer solution is ${x}`, "kernel");
}

function checkQuantity(record) {
  let match;
  if ((match = /^add (-?\d+) (-?\d+)$/.exec(record.input))) return record.artifact === `result ${Number(match[1]) + Number(match[2])}`;
  if ((match = /^multiply (-?\d+) (-?\d+)$/.exec(record.input))) return record.artifact === `result ${Number(match[1]) * Number(match[2])}`;
  if ((match = /^add-rational (-?\d+)\/(\d+) (-?\d+)\/(\d+)$/.exec(record.input))) {
    return record.artifact === `result ${rational(Number(match[1]) * Number(match[4]) + Number(match[3]) * Number(match[2]), Number(match[2]) * Number(match[4]))}`;
  }
  if ((match = /^convert (\d+) (m-to-cm|cm-to-mm|kg-to-g)$/.exec(record.input))) {
    const factor = match[2] === "m-to-cm" ? 100 : match[2] === "cm-to-mm" ? 10 : 1000;
    const unit = match[2] === "m-to-cm" ? "cm" : match[2] === "cm-to-mm" ? "mm" : "g";
    return record.artifact === `result ${Number(match[1]) * factor} ${unit}`;
  }
  if ((match = /^solve (\d+)\*x\+(-?\d+)=(-?\d+)$/.exec(record.input))) {
    const a = Number(match[1]), b = Number(match[2]), c = Number(match[3]);
    return (c - b) % a === 0 && record.artifact === `x ${(c - b) / a}`;
  }
  return false;
}

function distance2(left, right) { return (left.x - right.x) ** 2 + (left.y - right.y) ** 2; }
function classifyTriangle(a, b, c) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (cross === 0) return "degenerate";
  const sides = [distance2(a, b), distance2(b, c), distance2(c, a)].sort((x, y) => x - y);
  if (sides[0] + sides[1] === sides[2]) return "right";
  if (sides[0] === sides[1] || sides[1] === sides[2]) return "isosceles";
  return "scalene";
}
function pointText(name, point) { return `${name} ${point.x} ${point.y}`; }

function geometryRecord(split, index, rng) {
  const mode = index % 5;
  if (mode === 0) {
    const a = { x: rng.int(-20, 20) * 2, y: rng.int(-20, 20) * 2 };
    const b = { x: rng.int(-20, 20) * 2, y: rng.int(-20, 20) * 2 };
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return baseRecord("geometry", split, index, "midpoint", `midpoint ${pointText("A", a)} ${pointText("B", b)}`, `point M ${m.x} ${m.y}`, `M is the exact midpoint of A and B`, "kernel");
  }
  if (mode === 1) {
    const a = { x: rng.int(-30, 30), y: rng.int(-30, 30) };
    return baseRecord("geometry", split, index, "reflect", `reflect-y ${pointText("A", a)}`, `point R ${-a.x} ${a.y}`, `R is A reflected across the y axis`, "kernel");
  }
  if (mode === 2) {
    const dx = rng.int(-20, 20) || 3, dy = rng.int(-20, 20) || 5;
    return baseRecord("geometry", split, index, "perpendicular", `perpendicular ${dx} ${dy}`, `vector P ${-dy} ${dx}`, `P has zero dot product with the input vector`, "kernel");
  }
  if (mode === 3) {
    const a = { x: rng.int(-20, 20), y: rng.int(-20, 20) }, dx = rng.int(-10, 10), dy = rng.int(-10, 10);
    return baseRecord("geometry", split, index, "translate", `translate ${pointText("A", a)} by ${dx} ${dy}`, `point T ${a.x + dx} ${a.y + dy}`, `T is A translated by the declared vector`, "kernel");
  }
  const kind = rng.pick(["right", "isosceles", "scalene"]);
  let a, b, c;
  if (kind === "right") { const p = rng.int(2, 12), q = p + rng.int(1, 8); a = { x: 0, y: 0 }; b = { x: p, y: 0 }; c = { x: 0, y: q }; }
  else if (kind === "isosceles") { const p = rng.int(2, 12), h = rng.int(2, 12); a = { x: -p, y: 0 }; b = { x: p, y: 0 }; c = { x: 0, y: h }; }
  else { a = { x: 0, y: 0 }; b = { x: rng.int(3, 12), y: 0 }; c = { x: rng.int(1, 4), y: rng.int(3, 12) }; while (classifyTriangle(a, b, c) !== "scalene") c.x += 1; }
  const classification = classifyTriangle(a, b, c);
  return baseRecord("geometry", split, index, "classify-triangle", `classify ${pointText("A", a)} ${pointText("B", b)} ${pointText("C", c)}`, `class ${classification}`, `the exact squared side relations classify the triangle as ${classification}`, "kernel");
}

function checkGeometry(record) {
  let match;
  if ((match = /^midpoint A (-?\d+) (-?\d+) B (-?\d+) (-?\d+)$/.exec(record.input))) return record.artifact === `point M ${(Number(match[1]) + Number(match[3])) / 2} ${(Number(match[2]) + Number(match[4])) / 2}`;
  if ((match = /^reflect-y A (-?\d+) (-?\d+)$/.exec(record.input))) return record.artifact === `point R ${-Number(match[1])} ${Number(match[2])}`;
  if ((match = /^perpendicular (-?\d+) (-?\d+)$/.exec(record.input))) {
    const output = /^vector P (-?\d+) (-?\d+)$/.exec(record.artifact);
    return Boolean(output) && Number(match[1]) * Number(output[1]) + Number(match[2]) * Number(output[2]) === 0;
  }
  if ((match = /^translate A (-?\d+) (-?\d+) by (-?\d+) (-?\d+)$/.exec(record.input))) return record.artifact === `point T ${Number(match[1]) + Number(match[3])} ${Number(match[2]) + Number(match[4])}`;
  if ((match = /^classify A (-?\d+) (-?\d+) B (-?\d+) (-?\d+) C (-?\d+) (-?\d+)$/.exec(record.input))) {
    const points = [{ x: Number(match[1]), y: Number(match[2]) }, { x: Number(match[3]), y: Number(match[4]) }, { x: Number(match[5]), y: Number(match[6]) }];
    return record.artifact === `class ${classifyTriangle(...points)}`;
  }
  return false;
}

function parseScene(text) {
  const scene = new Map();
  for (const item of text.split(";")) {
    const fields = item.trim().split(":");
    if (fields.length !== 7) return null;
    const [id, shape, color, x, y, size, layer] = fields;
    const object = { id, shape, color, x: Number(x), y: Number(y), size: Number(size), layer: Number(layer) };
    if (!/^[abc]$/.test(id) || !["circle", "square", "triangle"].includes(shape) || !["red", "blue", "gold", "black"].includes(color) || ![object.x, object.y, object.size, object.layer].every(Number.isFinite)) return null;
    scene.set(id, object);
  }
  return scene;
}
function artConstraints(input) {
  const marker = input.indexOf("constraints ");
  if (marker < 0) return null;
  return input.slice(marker + 12).split(",").map((value) => value.trim());
}
function checkSceneConstraints(scene, constraints) {
  for (const constraint of constraints) {
    let match;
    if ((match = /^([abc]) left-of ([abc])$/.exec(constraint))) { if (!(scene.get(match[1])?.x < scene.get(match[2])?.x)) return false; }
    else if ((match = /^([abc]) above ([abc])$/.exec(constraint))) { if (!(scene.get(match[1])?.y < scene.get(match[2])?.y)) return false; }
    else if ((match = /^([abc]) front-of ([abc])$/.exec(constraint))) { if (!(scene.get(match[1])?.layer > scene.get(match[2])?.layer)) return false; }
    else if ((match = /^([abc]) is (red|blue|gold|black) (circle|square|triangle)$/.exec(constraint))) {
      const object = scene.get(match[1]); if (!object || object.color !== match[2] || object.shape !== match[3]) return false;
    } else return false;
  }
  return true;
}
function sceneText(objects) { return objects.map((object) => `${object.id}:${object.shape}:${object.color}:${object.x}:${object.y}:${object.size}:${object.layer}`).join(";"); }

function artRecord(split, index, rng) {
  const shapes = ["circle", "square", "triangle"], colors = ["red", "blue", "gold", "black"];
  const a = { id: "a", shape: rng.pick(shapes), color: rng.pick(colors), x: rng.int(12, 35), y: rng.int(12, 38), size: rng.int(9, 18), layer: 0 };
  const b = { id: "b", shape: rng.pick(shapes), color: rng.pick(colors), x: rng.int(60, 88), y: rng.int(58, 86), size: rng.int(12, 24), layer: 2 };
  const constraints = [`a is ${a.color} ${a.shape}`, `b is ${b.color} ${b.shape}`, "a left-of b", "a above b", "b front-of a"];
  const valid = sceneText([a, b]);
  const repair = index % 2 === 1;
  const bad = sceneText([{ ...a, x: b.x + 3 }, { ...b, x: a.x - 3 }]);
  const input = repair ? `repair scene ${bad} constraints ${constraints.join(",")}` : `compose constraints ${constraints.join(",")}`;
  return baseRecord("art", split, index, repair ? "repair-scene" : "compose-scene", input, `scene ${valid}`, `the scene satisfies five explicit composition constraints`, "constraint-checker");
}
function checkArt(record) {
  if (!record.artifact.startsWith("scene ")) return false;
  const scene = parseScene(record.artifact.slice(6));
  const constraints = artConstraints(record.input);
  return Boolean(scene && constraints && checkSceneConstraints(scene, constraints));
}

function protocolRecord(split, index) {
  const channels = [["quantity", "Q"], ["geometry", "G"], ["art", "A"]];
  const [target, code] = channels[index % channels.length];
  const variant = index % 17;
  const record = baseRecord("protocol", split, index, "complete-boundary", `emit one complete ${target} chunk variant ${variant}`, `boundary ${target} ${variant}`, `${target} chunk closed atomically`, "protocol-kernel");
  record.channel_code = code;
  record.previous_summary = `${target} channel boundary fixture`;
  return record;
}
function checkProtocol(record) {
  const match = /^emit one complete (quantity|geometry|art) chunk variant (\d+)$/.exec(record.input);
  return Boolean(match && record.channel_code === CHANNEL_CODE[match[1]] && record.artifact === `boundary ${match[1]} ${match[2]}` && record.summary === `${match[1]} chunk closed atomically`);
}
function renderSvg(record) {
  const scene = parseScene(record.artifact.slice(6));
  const objects = [...scene.values()].sort((left, right) => left.layer - right.layer);
  const shapes = objects.map((object) => {
    if (object.shape === "circle") return `<circle cx="${object.x}" cy="${object.y}" r="${object.size / 2}" fill="${object.color}"/>`;
    if (object.shape === "square") return `<rect x="${object.x - object.size / 2}" y="${object.y - object.size / 2}" width="${object.size}" height="${object.size}" fill="${object.color}"/>`;
    const half = object.size / 2;
    return `<polygon points="${object.x},${object.y - half} ${object.x - half},${object.y + half} ${object.x + half},${object.y + half}" fill="${object.color}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/>${shapes.join("")}</svg>\n`;
}

const GENERATORS = { quantity: quantityRecord, geometry: geometryRecord, art: artRecord, protocol: protocolRecord };
const CHECKERS = { quantity: checkQuantity, geometry: checkGeometry, art: checkArt, protocol: checkProtocol };
function seedFor(base, domain, split, index) {
  const digest = crypto.createHash("sha256").update(`${base}:${domain}:${split}:${index}`).digest();
  return digest.readUInt32LE(0) || 1;
}
function atomicWrite(file, data) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}
function tokenBuffer(records) {
  const encoded = records.map(encodeRecord);
  const count = encoded.reduce((total, record) => total + record.length, 0);
  const buffer = Buffer.allocUnsafe(count * 2);
  let offset = 0;
  for (const record of encoded) for (const token of record) { buffer.writeUInt16LE(token, offset); offset += 2; }
  return { buffer, tokens: count };
}
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

function generateDomain(out, domain, requested, seed) {
  const trainCount = Math.floor(requested * 0.95);
  const validationCount = requested - trainCount;
  const promotionCount = Math.max(20, Math.floor(requested * 0.05));
  const records = [];
  for (const [split, count] of [["train", trainCount], ["validation", validationCount], ["promotion", promotionCount]]) {
    for (let index = 0; index < count; ++index) {
      const record = GENERATORS[domain](split, index, new Rng(seedFor(seed, domain, split, index)));
      if (!CHECKERS[domain](record)) fail(`checker rejected generated record ${record.id}`);
      encodeRecord(record);
      records.push(record);
    }
  }
  const trainValidation = records.filter((record) => record.split !== "promotion");
  const tokenized = tokenBuffer(trainValidation);
  const jsonl = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const preview = records.filter((record) => record.split === "train").slice(0, 12).map(previewRecord).join("");
  const promotion = `id\tdomain\tprevious_summary\tinput\tartifact\tsummary\n${records.filter((record) => record.split === "promotion").map((record) => [record.id, record.domain, record.previous_summary, record.input, record.artifact, record.summary].join("\t")).join("\n")}\n`;
  const jsonlPath = path.join(out, `${domain}.jsonl`), tokenPath = path.join(out, `${domain}.tok`), previewPath = path.join(out, `${domain}.PREVIEW.txt`), promotionPath = path.join(out, `${domain}.promotion.tsv`);
  atomicWrite(jsonlPath, jsonl);
  atomicWrite(tokenPath, tokenized.buffer);
  atomicWrite(previewPath, preview);
  atomicWrite(promotionPath, promotion);
  if (domain === "art") {
    const svgDir = path.join(out, "art-svg"); fs.mkdirSync(svgDir, { recursive: true });
    records.filter((record) => record.split === "train").slice(0, 12).forEach((record, index) => atomicWrite(path.join(svgDir, `art-${String(index).padStart(3, "0")}.svg`), renderSvg(record)));
  }
  return {
    requested_train_validation_records: requested,
    records: { train: trainCount, validation: validationCount, promotion: promotionCount },
    channel_tokens: tokenized.tokens,
    files: {
      jsonl: { path: path.basename(jsonlPath), sha256: sha256(jsonlPath) },
      tokens: { path: path.basename(tokenPath), sha256: sha256(tokenPath), encoding: "uint16-le" },
      preview: { path: path.basename(previewPath), sha256: sha256(previewPath) },
      promotion: { path: path.basename(promotionPath), sha256: sha256(promotionPath), format: "tsv" }
    }
  };
}

function checkDirectory(out) {
  const manifestPath = path.join(out, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  let checked = 0;
  for (const domain of Object.keys(GENERATORS)) {
    const details = manifest.domains[domain];
    for (const metadata of Object.values(details.files)) {
      const file = path.join(out, metadata.path);
      if (sha256(file) !== metadata.sha256) fail(`hash mismatch for ${file}`);
    }
    const lines = fs.readFileSync(path.join(out, details.files.jsonl.path), "utf8").trim().split("\n");
    const splitCounts = { train: 0, validation: 0, promotion: 0 };
    for (const line of lines) {
      const record = JSON.parse(line);
      if (record.domain !== domain || !CHECKERS[domain](record) || encodeRecord(record).length > MAX_RECORD_TOKENS) fail(`invalid checked record ${record.id}`);
      splitCounts[record.split] += 1; checked += 1;
    }
    for (const split of Object.keys(splitCounts)) if (splitCounts[split] !== details.records[split]) fail(`${domain} ${split} count mismatch`);
    const promotionLines = fs.readFileSync(path.join(out, details.files.promotion.path), "utf8").trim().split("\n");
    if (promotionLines[0] !== "id\tdomain\tprevious_summary\tinput\tartifact\tsummary" || promotionLines.length - 1 !== details.records.promotion) fail(`${domain} promotion TSV mismatch`);
  }
  console.log(`zero4 faculty check: ${checked} canonical records, independent validators, hashes, splits, and channel bounds passed`);
}

function parseArgs(argv) {
  const options = { out: "corpus/faculty/generated", quantity: 10000, geometry: 10000, art: 5000, protocol: 3000, seed: 4, check: false };
  for (let index = 2; index < argv.length; ++index) {
    const option = argv[index];
    if (option === "--check") options.check = true;
    else if (["--out", "--quantity", "--geometry", "--art", "--protocol", "--seed"].includes(option) && index + 1 < argv.length) {
      const key = option.slice(2); options[key] = key === "out" ? argv[++index] : Number(argv[++index]);
    } else fail(`unknown or incomplete option ${option}`);
  }
  for (const key of ["quantity", "geometry", "art", "protocol"]) if (!Number.isInteger(options[key]) || options[key] < 20) fail(`${key} must be an integer >= 20`);
  return options;
}

const options = parseArgs(process.argv);
if (options.check) checkDirectory(options.out);
else {
  fs.mkdirSync(options.out, { recursive: true });
  const manifest = {
    schema: "zero.faculty_corpus_manifest.v1",
    generator: "scripts/generate_zero4_faculty.mjs",
    generator_version: 1,
    seed: options.seed,
    split_policy: "latent unit assigned before surface generation; token files contain ordered 95% train then 5% validation; promotion is canonical-sidecar only",
    authority_policy: "quantity and geometry use exact independent checkers; art uses a symbolic scene constraint checker; no model-generated record is self-approved",
    domains: {}
  };
  for (const domain of ["quantity", "geometry", "art", "protocol"]) manifest.domains[domain] = generateDomain(options.out, domain, options[domain], options.seed);
  atomicWrite(path.join(options.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  checkDirectory(options.out);
  console.log(`generated ZERO.4 faculty pilots in ${options.out}`);
}
