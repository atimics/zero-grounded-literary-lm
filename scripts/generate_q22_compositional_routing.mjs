#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = "zero.q22_compositional_routing_corpus.v1";
const TASKS = ["add", "multiply", "add-rational", "convert", "solve-linear"];
const OPERATIONS = [
  "quantity.add",
  "quantity.multiply",
  "quantity.add-rational",
  "quantity.convert",
  "quantity.solve-linear",
];
const COMMON_PREFIX = "Route this quantity case.";

const templates = {
  add: {
    train: [
      (v) => `Starting with ${v.a}, combine it with ${v.b}.`,
      (v) => `A balance of ${v.a} receives ${v.b} more.`,
      (v) => `Join the signed amounts ${v.a} and ${v.b}.`,
      (v) => `Increase ${v.a} by the change ${v.b}.`,
      (v) => `Find the total of ${v.a} together with ${v.b}.`,
      (v) => `Accumulate the adjustment ${v.b} on the base ${v.a}.`,
    ],
    promotion: [
      (v) => `What amount results when ${v.b} is added onto ${v.a}?`,
      (v) => `Merge a signed change of ${v.b} into an initial ${v.a}.`,
      (v) => `Place ${v.b} on top of ${v.a} and report the combined amount.`,
      (v) => `Determine their joint signed total: ${v.a} with ${v.b}.`,
    ],
  },
  multiply: {
    train: [
      (v) => `${v.a} groups each contain ${v.b} items.`,
      (v) => `Scale ${v.a} by the factor ${v.b}.`,
      (v) => `Repeat the signed amount ${v.b} exactly ${v.a} times.`,
      (v) => `Find the product formed by ${v.a} and ${v.b}.`,
      (v) => `A rectangle has signed side measures ${v.a} and ${v.b}.`,
      (v) => `Apply ${v.b} as a multiplicative factor to ${v.a}.`,
    ],
    promotion: [
      (v) => `What is produced by ${v.a} copies of ${v.b}?`,
      (v) => `Combine ${v.a} equal batches, with ${v.b} in every batch.`,
      (v) => `Enlarge the signed value ${v.a} by a scale of ${v.b}.`,
      (v) => `Determine the repeated-group amount for ${v.a} groups of ${v.b}.`,
    ],
  },
  "add-rational": {
    train: [
      (v) => `Combine the fractional amounts ${v.left} and ${v.right}.`,
      (v) => `A rational balance of ${v.left} receives another ${v.right}.`,
      (v) => `Join ${v.left} of a unit with ${v.right} of the same unit.`,
      (v) => `Find the total share represented by ${v.left} together with ${v.right}.`,
      (v) => `Accumulate the two ratios ${v.left} and ${v.right}.`,
      (v) => `Merge a fractional change of ${v.right} into ${v.left}.`,
    ],
    promotion: [
      (v) => `What combined fraction is formed from ${v.left} plus ${v.right}?`,
      (v) => `Pool the rational portions ${v.left} and ${v.right}.`,
      (v) => `Place the share ${v.right} alongside the existing share ${v.left}.`,
      (v) => `Determine the joint rational amount for ${v.left} with ${v.right}.`,
    ],
  },
  convert: {
    train: [
      (v) => `Express ${v.value} ${v.from} using ${v.to}.`,
      (v) => `Rewrite a measurement of ${v.value} ${v.from} in ${v.to}.`,
      (v) => `Change the unit on ${v.value} ${v.from} so it is stated in ${v.to}.`,
      (v) => `Report ${v.value} ${v.from} on the ${v.to} scale.`,
      (v) => `Translate the measure ${v.value} from ${v.from} units to ${v.to} units.`,
      (v) => `Restate ${v.value} ${v.from} with ${v.to} as the unit.`,
    ],
    promotion: [
      (v) => `How many ${v.to} represent the same length or mass as ${v.value} ${v.from}?`,
      (v) => `Use ${v.to}, rather than ${v.from}, to write the measure ${v.value}.`,
      (v) => `Move ${v.value} ${v.from} onto an equivalent ${v.to} unit scale.`,
      (v) => `Give the ${v.to} form of a quantity recorded as ${v.value} ${v.from}.`,
    ],
  },
  "solve-linear": {
    train: [
      (v) => `Find the unknown x in ${v.coefficient}*x+${v.offset}=${v.result}.`,
      (v) => `Which x balances ${v.coefficient}*x plus ${v.offset} against ${v.result}?`,
      (v) => `Isolate x when ${v.coefficient} copies of x and ${v.offset} total ${v.result}.`,
      (v) => `Recover the missing x from ${v.coefficient}*x+${v.offset}=${v.result}.`,
      (v) => `Determine the root of the linear equality ${v.coefficient}*x+${v.offset}=${v.result}.`,
      (v) => `Choose x so that adding ${v.offset} after scaling by ${v.coefficient} gives ${v.result}.`,
    ],
    promotion: [
      (v) => `What value must x have for ${v.coefficient}*x+${v.offset} to equal ${v.result}?`,
      (v) => `Undo the linear balance ${v.result}=${v.offset}+${v.coefficient}*x and report x.`,
      (v) => `The expression ${v.coefficient}*x+${v.offset} lands on ${v.result}; identify x.`,
      (v) => `Supply the missing number x that satisfies ${v.coefficient}*x+${v.offset}=${v.result}.`,
    ],
  },
};

const decoys = {
  add: "A discarded note talks about joining two unrelated signed amounts",
  multiply: "A discarded note talks about equal groups and a scale factor",
  "add-rational": "A discarded note talks about pooling two fractional shares",
  convert: "A discarded note talks about restating meters in centimeters",
  "solve-linear": "A discarded note talks about isolating an unknown in an equation",
};

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
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function atomicWrite(file, data) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, data); fs.renameSync(temporary, file); }
function seedFor(base, split, index) {
  return crypto.createHash("sha256").update(`${base}:q22-compositional:${split}:${index}`).digest().readUInt32LE(0) || 1;
}

function valuesFor(task, rng) {
  if (task === "add") {
    const a = rng.int(-999, 999), b = rng.int(-999, 999);
    return { a, b, request: `quantity.add ${a} ${b}`, artifact: `result ${a + b}` };
  }
  if (task === "multiply") {
    const a = rng.int(-49, 49), b = rng.int(-49, 49);
    return { a, b, request: `quantity.multiply ${a} ${b}`, artifact: `result ${a * b}` };
  }
  if (task === "add-rational") {
    const a = rng.int(-24, 24), b = rng.int(1, 24), c = rng.int(-24, 24), d = rng.int(1, 24);
    return {
      left: `${a}/${b}`,
      right: `${c}/${d}`,
      request: `quantity.add-rational ${a}/${b} ${c}/${d}`,
      artifact: `result ${rational(a * d + c * b, b * d)}`,
    };
  }
  if (task === "convert") {
    const value = rng.int(1, 999);
    const conversion = rng.pick([
      { code: "m-to-cm", from: "meters", to: "centimeters", factor: 100, unit: "cm" },
      { code: "cm-to-mm", from: "centimeters", to: "millimeters", factor: 10, unit: "mm" },
      { code: "kg-to-g", from: "kilograms", to: "grams", factor: 1000, unit: "g" },
    ]);
    return {
      value,
      ...conversion,
      request: `quantity.convert ${value} ${conversion.code}`,
      artifact: `result ${value * conversion.factor} ${conversion.unit}`,
    };
  }
  const coefficient = rng.int(1, 24), x = rng.int(-99, 99), offset = rng.int(-99, 99);
  const result = coefficient * x + offset;
  return {
    coefficient,
    x,
    offset,
    result,
    request: `quantity.solve-linear ${coefficient} ${offset} ${result}`,
    artifact: `x ${x}`,
  };
}

function makeRecord(split, index, baseSeed) {
  const taskIndex = index % TASKS.length;
  const task = TASKS[taskIndex];
  const cycle = Math.floor(index / TASKS.length);
  const rng = new Rng(seedFor(baseSeed, split, index));
  const splitTemplates = templates[task][split];
  const templateIndex = cycle % splitTemplates.length;
  const decoyIndex = (taskIndex + 1 + (cycle % (TASKS.length - 1))) % TASKS.length;
  const decoyTask = TASKS[decoyIndex];
  const values = valuesFor(task, rng);
  const actual = splitTemplates[templateIndex](values);
  const input = `${COMMON_PREFIX} Background: ${decoys[decoyTask]}. Actual case: ${actual} Respond with the operation code.`;
  const id = `quantity-composition/${split}/${String(index).padStart(6, "0")}`;
  return {
    schema: "zero.faculty_operation_request.v2",
    id,
    domain: "quantity",
    curriculum: "quantity-compositional-routing-v1",
    split,
    split_unit: id,
    authority: "kernel",
    source: { kind: "synthetic", generator: "generate_q22_compositional_routing.mjs", version: 1, seed: seedFor(baseSeed, split, index) },
    template_family: `${split}/${task}/${templateIndex}`,
    template_signature: actual.replace(/-?\d+/g, "#"),
    decoy_task: decoyTask,
    previous_summary: "quantity routing has no prior committed result",
    task,
    input,
    model_request: OPERATIONS[taskIndex],
    request: values.request,
    artifact: values.artifact,
    summary: `kernel committed ${values.artifact}`,
  };
}

function evaluateRow(record) {
  return [record.id, record.domain, record.previous_summary, record.input, record.model_request, record.request, record.artifact, record.summary].join("\t");
}

function validateRecords(records, trainCount, evalCount) {
  const expectedCounts = { train: trainCount, promotion: evalCount };
  const counts = { train: 0, promotion: 0 };
  const classCounts = { train: new Map(), promotion: new Map() };
  const decoyCounts = { train: new Map(), promotion: new Map() };
  const templateFamilies = { train: new Set(), promotion: new Set() };
  const templateSignatures = { train: new Set(), promotion: new Set() };
  const prefixes = new Set();
  const ids = new Set();
  for (const record of records) {
    if (!Object.hasOwn(counts, record.split) || ids.has(record.id)) fail(`invalid identity: ${record.id}`);
    if (!TASKS.includes(record.task) || record.model_request !== OPERATIONS[TASKS.indexOf(record.task)]) fail(`invalid task binding: ${record.id}`);
    if (!record.input.startsWith(`${COMMON_PREFIX} `) || OPERATIONS.some((operation) => record.input.includes(operation))) fail(`label leakage: ${record.id}`);
    if (record.summary !== `kernel committed ${record.artifact}` || !record.request.startsWith(`${record.model_request} `)) fail(`kernel binding drifted: ${record.id}`);
    const prefix = record.input.split(/\s+/).slice(0, 4).join(" ");
    prefixes.add(prefix);
    ids.add(record.id);
    counts[record.split] += 1;
    classCounts[record.split].set(record.task, (classCounts[record.split].get(record.task) ?? 0) + 1);
    const decoyKey = `${record.task}/${record.decoy_task}`;
    decoyCounts[record.split].set(decoyKey, (decoyCounts[record.split].get(decoyKey) ?? 0) + 1);
    templateFamilies[record.split].add(record.template_family);
    templateSignatures[record.split].add(record.template_signature);
  }
  if (counts.train !== expectedCounts.train || counts.promotion !== expectedCounts.promotion) fail("split counts drifted");
  if (prefixes.size !== 1) fail("the four-token prefix must be identical across every class and split");
  for (const split of ["train", "promotion"]) {
    const perClass = expectedCounts[split] / TASKS.length;
    if (!TASKS.every((task) => classCounts[split].get(task) === perClass)) fail(`${split} classes are not balanced`);
    const perDecoy = perClass / (TASKS.length - 1);
    for (const task of TASKS) for (const decoy of TASKS.filter((candidate) => candidate !== task)) {
      if (decoyCounts[split].get(`${task}/${decoy}`) !== perDecoy) fail(`${split} decoys are not balanced for ${task}/${decoy}`);
    }
  }
  if ([...templateFamilies.train].some((family) => templateFamilies.promotion.has(family))) fail("template families overlap across splits");
  if ([...templateSignatures.train].some((signature) => templateSignatures.promotion.has(signature))) fail("normalized template surfaces overlap across splits");
  return { counts, classCounts, templateFamilies, templateSignatures, prefix: [...prefixes][0] };
}

function generate(options) {
  if (options.train % 20 !== 0 || options.eval % 20 !== 0) fail("train and eval counts must be positive multiples of 20");
  fs.mkdirSync(options.out, { recursive: true });
  const records = [];
  for (let index = 0; index < options.train; index += 1) records.push(makeRecord("train", index, options.seed));
  for (let index = 0; index < options.eval; index += 1) records.push(makeRecord("promotion", index, options.seed));
  const audit = validateRecords(records, options.train, options.eval);
  const files = {
    canonical: path.join(options.out, "quantity-composition.jsonl"),
    train: path.join(options.out, "quantity-composition.train.jsonl"),
    promotion: path.join(options.out, "quantity-composition.promotion.tsv"),
  };
  atomicWrite(files.canonical, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  atomicWrite(files.train, `${records.filter((record) => record.split === "train").map((record) => JSON.stringify(record)).join("\n")}\n`);
  const header = "id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary";
  atomicWrite(files.promotion, `${header}\n${records.filter((record) => record.split === "promotion").map(evaluateRow).join("\n")}\n`);
  const manifest = {
    schema: SCHEMA,
    shared_task_id: "zero-solomon.q22-compositional-routing.v1",
    generator: "scripts/generate_q22_compositional_routing.mjs",
    seed: options.seed,
    records: { train: options.train, promotion: options.eval },
    invariants: {
      common_prefix: audit.prefix,
      common_prefix_tokens: 4,
      class_count: TASKS.length,
      prefix_only_exact_rate_ppm: 200000,
      train_template_families: audit.templateFamilies.train.size,
      promotion_template_families: audit.templateFamilies.promotion.size,
      template_families_disjoint: true,
      normalized_template_surfaces_disjoint: true,
      decoy_classes_balanced_per_target: true,
      literal_operation_identifiers_absent_from_inputs: true,
    },
    files: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, { path: path.basename(file), sha256: sha256(file) }])),
  };
  atomicWrite(path.join(options.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Q22 compositional routing corpus passed: ${options.train} train, ${options.eval} promotion, prefix baseline 200000 ppm`);
}

function checkDirectory(out) {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  if (manifest.schema !== SCHEMA || manifest.shared_task_id !== "zero-solomon.q22-compositional-routing.v1") fail("generated manifest identity drifted");
  for (const binding of Object.values(manifest.files)) if (sha256(path.join(out, binding.path)) !== binding.sha256) fail(`generated file drifted: ${binding.path}`);
  const records = fs.readFileSync(path.join(out, manifest.files.canonical.path), "utf8").trimEnd().split("\n").map(JSON.parse);
  validateRecords(records, manifest.records.train, manifest.records.promotion);
  console.log(`Q22 compositional routing directory check passed: ${records.length} records`);
}

function parseArgs(argv) {
  const options = { out: "corpus/faculty/q22-compositional", train: 10000, eval: 1000, seed: 23, check: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (["--out", "--train", "--eval", "--seed"].includes(arg) && argv[index + 1] !== undefined) {
      const key = arg.slice(2);
      options[key] = key === "out" ? argv[++index] : Number(argv[++index]);
    } else fail(`unknown or incomplete option: ${arg}`);
  }
  if (![options.train, options.eval, options.seed].every(Number.isInteger)) fail("counts and seed must be integers");
  options.out = path.resolve(options.out);
  return options;
}

const options = parseArgs(process.argv);
if (options.check) checkDirectory(options.out);
else generate(options);
