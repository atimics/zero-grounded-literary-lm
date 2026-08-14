#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const SOURCE = "corpus/faculty/q22/quantity-request.jsonl";
const SOURCE_SHA256 =
  "49a94fceabab5ad37791743f9ae5dbe8faccd38a77860cfd970246263b850d3a";
const ROOT = "benchmarks/zero4-q34-semantic-head-v1";
const CLASSES = ["add", "multiply", "add-rational", "convert", "solve-linear"];
const LENGTH_BUCKETS = [160, 176, 192, 208, 224];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const BANKS = {
  train: {
    add: {
      lexical: [(a,b)=>`Return the sum of ${a} with ${b}.`,
        (a,b)=>`Calculate ${a} plus ${b}.`,
        (a,b)=>`Give the combined total for ${a} and ${b}.`],
      implicit: [(a,b)=>`Begin at ${a}; a signed change of ${b} follows. Where are you now?`,
        (a,b)=>`One ledger shows ${a} and receives a change of ${b}. What balance results?`,
        (a,b)=>`Merge signed amounts ${a} and ${b}. What single amount remains?`]
    },
    multiply: {
      lexical: [(a,b)=>`Return the product of ${a} with ${b}.`,
        (a,b)=>`Calculate ${a} times ${b}.`,
        (a,b)=>`Give ${b} scaled by the factor ${a}.`],
      implicit: [(a,b)=>`A signed rectangle has dimensions ${a} by ${b}. What is its signed area?`,
        (a,b)=>`A coefficient of ${a} acts on ${b}. What value comes out?`,
        (a,b)=>`Apply the signed rate ${a} across ${b} units. What total results?`]
    },
    "add-rational": {
      lexical: [(a,b)=>`Return the reduced fractional sum of ${a} with ${b}.`,
        (a,b)=>`Calculate the rational value ${a} plus ${b}.`,
        (a,b)=>`Combine fractions ${a} and ${b} into one reduced fraction.`],
      implicit: [(a,b)=>`A rational balance starts at ${a} and changes by ${b}. Where does it end?`,
        (a,b)=>`Join a portion of ${a} with another portion of ${b}. What portion results?`,
        (a,b)=>`Two signed fractional amounts are ${a} and ${b}. What is their joint amount?`]
    },
    convert: {
      lexical: [(v,f,t)=>`Express ${v} ${f} in ${t}.`,
        (v,f,t)=>`Give the equivalent of ${v} ${f} using ${t}.`,
        (v,f,t)=>`Restate ${v} ${f} as ${t}.`],
      implicit: [(v,f,t,fs,ts,k)=>`The same ${k} is labeled ${v} ${fs}. What number belongs on its ${ts} label?`,
        (v,f,t,fs,ts,k)=>`Keep the ${k} unchanged: ${v} ${f} corresponds to how many ${t}?`,
        (v,f,t,fs,ts)=>`A reading shows ${v} ${fs}; what equivalent reading uses ${ts}?`]
    },
    "solve-linear": {
      lexical: [(a,b,c)=>`Find x in the linear equation ${a}*x+${b}=${c}.`,
        (a,b,c)=>`Determine x when ${a}*x+${b} equals ${c}.`,
        (a,b,c)=>`Calculate the unknown x satisfying ${a}*x+${b}=${c}.`],
      implicit: [(a,b,c)=>`Which number at x makes ${a}*x+${b}=${c} true?`,
        (a,b,c)=>`A hidden x balances ${a}*x+${b} against ${c}. What is x?`,
        (a,b,c)=>`Choose the x that makes both sides of ${a}*x+${b}=${c} match.`]
    }
  },
  private: {
    add: { lexical: [(a,b)=>`What sum is obtained from ${a} and ${b}?`,
      (a,b)=>`Evaluate ${a} plus the value ${b}.`,
      (a,b)=>`Total the signed numbers ${a} and ${b}.`],
      implicit: [(a,b)=>`Move from ${a} by the signed distance ${b}. Where do you arrive?`,
        (a,b)=>`A score of ${a} changes by ${b}. What is the resulting score?`,
        (a,b)=>`Amounts ${a} and ${b} enter one balance. What does it show?`] },
    multiply: { lexical: [(a,b)=>`What product comes from ${a} and ${b}?`,
      (a,b)=>`Evaluate ${a} times the value ${b}.`,
      (a,b)=>`Use ${a} as a scale factor on ${b}.`],
      implicit: [(a,b)=>`The signed side lengths ${a} and ${b} define an area. What is it?`,
        (a,b)=>`A transformation scales ${b} by ${a}. What output appears?`,
        (a,b)=>`There are ${a} signed units for each of ${b} units. What total appears?`] },
    "add-rational": { lexical: [(a,b)=>`What reduced sum comes from fractions ${a} and ${b}?`,
      (a,b)=>`Evaluate the rational expression ${a} plus ${b}.`,
      (a,b)=>`Total fractional values ${a} and ${b}.`],
      implicit: [(a,b)=>`Move from rational point ${a} by ${b}. Where do you arrive?`,
        (a,b)=>`A fractional balance of ${a} changes by ${b}. What does it show?`,
        (a,b)=>`Portions ${a} and ${b} enter one measure. What amount is present?`] },
    convert: { lexical: [(v,f,t)=>`What is ${v} ${f} when stated in ${t}?`,
      (v,f,t)=>`Write the equivalent ${t} value for ${v} ${f}.`,
      (v,f,t)=>`Translate ${v} ${f} into ${t}.`],
      implicit: [(v,f,t,fs,ts,k)=>`One unchanged ${k} reads ${v} ${fs}. What would its ${ts} reading be?`,
        (v,f,t,fs,ts)=>`Replace the unit ${fs} with ${ts} without changing the amount ${v}. What number results?`,
        (v,f,t)=>`The amount ${v} ${f} is unchanged but measured in ${t}. What is the reading?`] },
    "solve-linear": { lexical: [(a,b,c)=>`What x satisfies the linear statement ${a}*x+${b}=${c}?`,
      (a,b,c)=>`Evaluate the unknown x in ${a}*x+${b}=${c}.`,
      (a,b,c)=>`Find the x-value making ${a}*x+${b} equal ${c}.`],
      implicit: [(a,b,c)=>`Which x makes the equality ${a}*x+${b}=${c} hold?`,
        (a,b,c)=>`The scale ${a}, hidden x, and offset ${b} must reach ${c}. What is x?`,
        (a,b,c)=>`Insert a number for x so ${a}*x+${b} and ${c} balance.`] }
  },
  confirm: {
    add: { lexical: [(a,b)=>`Provide the arithmetic sum for ${a} together with ${b}.`,
      (a,b)=>`How much does ${a} plus ${b} produce?`,
      (a,b)=>`Combine the signed pair ${a}, ${b} into a total.`],
      implicit: [(a,b)=>`A counter begins at ${a} and shifts ${b}. Where does it finish?`,
        (a,b)=>`The first signed contribution is ${a}; the second is ${b}. What is the net amount?`,
        (a,b)=>`After a balance of ${a} receives ${b}, what balance remains?`] },
    multiply: { lexical: [(a,b)=>`Provide the arithmetic product for ${a} together with ${b}.`,
      (a,b)=>`How much does ${a} times ${b} produce?`,
      (a,b)=>`Apply factor ${a} to ${b} and report the result.`],
      implicit: [(a,b)=>`A signed area uses width ${a} and height ${b}. What area results?`,
        (a,b)=>`An operator repeats the scale ${a} across value ${b}. What comes out?`,
        (a,b)=>`A signed rate ${a} spans ${b} intervals. What accumulated amount appears?`] },
    "add-rational": { lexical: [(a,b)=>`Provide the reduced rational sum for ${a} together with ${b}.`,
      (a,b)=>`How much does fraction ${a} plus fraction ${b} produce?`,
      (a,b)=>`Combine rational pair ${a}, ${b} into one value.`],
      implicit: [(a,b)=>`A fractional counter begins at ${a} and shifts ${b}. Where does it finish?`,
        (a,b)=>`The first fractional contribution is ${a}; the second is ${b}. What is the net amount?`,
        (a,b)=>`After a rational balance of ${a} receives ${b}, what balance remains?`] },
    convert: { lexical: [(v,f,t)=>`Provide the ${t} equivalent for ${v} ${f}.`,
      (v,f,t)=>`How many ${t} represent ${v} ${f}?`,
      (v,f,t)=>`Change only the unit notation of ${v} ${f} to ${t}.`],
      implicit: [(v,f,t,fs,ts,k)=>`A fixed ${k} marked ${v} ${fs} needs a ${ts} label. What number is printed?`,
        (v,f,t,fs,ts,k)=>`The ${k} stays identical while ${fs} is replaced by ${ts}. Starting from ${v}, what is shown?`,
        (v,f,t)=>`Two labels describe one amount: one is ${v} ${f}; what is the ${t} label?`] },
    "solve-linear": { lexical: [(a,b,c)=>`Provide the root x for ${a}*x+${b}=${c}.`,
      (a,b,c)=>`How much must x be for ${a}*x+${b} to produce ${c}?`,
      (a,b,c)=>`Determine the unknown in the relation ${a}*x+${b}=${c}.`],
      implicit: [(a,b,c)=>`A number substituted for x makes ${a}*x+${b} and ${c} identical. Which number?`,
        (a,b,c)=>`The left side ${a}*x+${b} must land exactly on ${c}. What x does that?`,
        (a,b,c)=>`Balance the statement ${a}*x+${b}=${c} by choosing x.`] }
  }
};

function conversionParts(value, mode) {
  const units = {
    "m-to-cm": ["meters", "centimeters", "m", "cm", "length"],
    "cm-to-mm": ["centimeters", "millimeters", "cm", "mm", "length"],
    "kg-to-g": ["kilograms", "grams", "kg", "g", "mass"]
  }[mode];
  assert(units); return [value, ...units];
}

function operationArguments(operation, canonical) {
  let match;
  if (operation === "add") match = /^add (-?\d+) (-?\d+)$/.exec(canonical);
  else if (operation === "multiply")
    match = /^multiply (-?\d+) (-?\d+)$/.exec(canonical);
  else if (operation === "add-rational")
    match = /^add-rational (-?\d+\/\d+) (-?\d+\/\d+)$/.exec(canonical);
  else if (operation === "convert") {
    match = /^convert (-?\d+) (m-to-cm|cm-to-mm|kg-to-g)$/.exec(canonical);
    assert(match); return conversionParts(match[1], match[2]);
  } else match = /^solve (-?\d+)\*x\+(-?\d+)=(-?\d+)$/.exec(canonical);
  assert(match, canonical); return match.slice(1);
}

function semanticInput(split, record, occurrence) {
  const operation = record.model_request.slice("quantity.".length);
  const stratum = occurrence % 2 === 0 ? "lexical" : "implicit";
  const template = Math.floor(occurrence / 2) % 3;
  let text = BANKS[split][operation][stratum][template](
    ...operationArguments(operation, record.input));
  assert(!/\b(?:add|multiply|convert|solve|quantity)\b/i.test(text), text);
  let target = LENGTH_BUCKETS[Math.floor(occurrence / 6) % LENGTH_BUCKETS.length];
  while (target < text.length) target += 80;
  text = text.padEnd(target, " ");
  return { text, stratum, template, visible_length: target };
}

function tsvRow(id, record, visible, stratum, template) {
  return [id, "quantity", record.previous_summary, visible, record.input,
    record.model_request, record.request, record.artifact, record.summary,
    stratum, template].join("\t");
}

function channelTokens(record, visible) {
  const text = (value) => [...value].map((character) => character.charCodeAt(0));
  return [1, "Q".charCodeAt(0), 7, ...text(record.previous_summary), 4, 2,
    "U".charCodeAt(0), ...text(visible), 4, 2, "Z".charCodeAt(0), 3,
    "U".charCodeAt(0), 6, ...text(`@request ${record.model_request} @close`),
    4, 5];
}

function writeTokens(path, tokens) {
  const buffer = Buffer.alloc(tokens.length * 2);
  tokens.forEach((token, index) => buffer.writeUInt16LE(token, index * 2));
  fs.writeFileSync(path, buffer, { flag: "wx" });
}

function main() {
  assert.equal(sha256(SOURCE), SOURCE_SHA256);
  assert(!fs.existsSync(ROOT)); fs.mkdirSync(ROOT, { recursive: false });
  const records = fs.readFileSync(SOURCE, "utf8").trim().split("\n")
    .map(JSON.parse);
  assert.equal(records.length, 10500);
  const header = "id\tdomain\tprevious_summary\tmodel_input\tcanonical_input\tmodel_request\tbound_request\tartifact\tsummary\tstratum\ttemplate_id";
  const privateRows = [header], confirmationRows = [header];
  const tokens = [], trainingCounts = { canonical: 0, semantic: 0 };
  for (let group = 0; group < 1800; ++group) {
    for (let classIndex = 0; classIndex < 5; ++classIndex) {
      const record = records[group * 5 + classIndex];
      const semantic = group % 2 === 1;
      const occurrence = Math.floor(group / 2);
      const visible = semantic ? semanticInput("train", record, occurrence).text :
        record.input;
      tokens.push(...channelTokens(record, visible));
      trainingCounts[semantic ? "semantic" : "canonical"]++;
    }
  }
  for (let index = 0; index < 500; ++index) {
    const record = records[9000 + index];
    const occurrence = Math.floor(index / 5);
    const semantic = semanticInput("private", record, occurrence);
    privateRows.push(tsvRow(`q34-private/${String(index).padStart(3,"0")}`,
      record, semantic.text, semantic.stratum, semantic.template));
    tokens.push(...channelTokens(record, semantic.text));
  }
  for (let index = 0; index < 500; ++index) {
    const record = records[9500 + index];
    const occurrence = Math.floor(index / 5);
    const semantic = semanticInput("confirm", record, occurrence);
    confirmationRows.push(tsvRow(
      `q34-confirm/${String(index).padStart(3,"0")}`, record, semantic.text,
      semantic.stratum, semantic.template));
    tokens.push(...channelTokens(record, semantic.text));
  }
  assert.deepEqual(trainingCounts, { canonical: 4500, semantic: 4500 });
  fs.writeFileSync(`${ROOT}/semantic-private.tsv`,
    `${privateRows.join("\n")}\n`, { flag: "wx" });
  fs.writeFileSync(`${ROOT}/semantic-confirmation.tsv`,
    `${confirmationRows.join("\n")}\n`, { flag: "wx" });
  writeTokens(`${ROOT}/mixed-training.tok`, tokens);
  const manifest = {
    schema: "zero.zero4_q34_semantic_data.v1", source: SOURCE,
    source_sha256: SOURCE_SHA256, records: { training: 9000,
      canonical_training: 4500, semantic_training: 4500,
      semantic_private: 500, semantic_confirmation: 500 },
    length_buckets: LENGTH_BUCKETS,
    files: {}
  };
  for (const name of ["mixed-training.tok", "semantic-private.tsv",
    "semantic-confirmation.tsv"]) manifest.files[name] = sha256(`${ROOT}/${name}`);
  fs.writeFileSync(`${ROOT}/data-manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log("wrote Q3.4 balanced canonical-semantic data");
}

main();
