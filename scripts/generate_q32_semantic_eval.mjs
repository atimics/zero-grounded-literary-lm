#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const SOURCE = "corpus/faculty/q22/quantity-request.promotion.tsv";
const SOURCE_SHA256 =
  "9270ea2b72af90235407bd7924a0864b8eba35b2969e1657ed1c15bf04449519";
const OUTPUT = "benchmarks/zero4-q33-semantic-v1/semantic-eval.tsv";
const CLASSES = ["add", "multiply", "add-rational", "convert", "solve-linear"];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function clean(text) {
  assert(!/[\t\r\n]/.test(text));
  assert(!/\b(?:add|multiply|convert|solve|quantity)\b/i.test(text),
    `literal operation leaked into model input: ${text}`);
  return text;
}

const TEMPLATES = {
  add: {
    lexical: [
      (a, b) => `What is the sum of ${a} and ${b}?`,
      (a, b) => `Compute ${a} plus ${b}.`,
      (a, b) => `Combine ${a} with ${b} by summing them.`,
      (a, b) => `What total results from ${a} and ${b}?`,
      (a, b) => `How much is ${a} together with ${b}?`,
    ],
    implicit: [
      (a, b) => `Start at ${a} on a number line and move by ${b}; where do you land?`,
      (a, b) => `A balance is ${a}, then changes by ${b}. What is the new balance?`,
      (a, b) => `Put ${a} units in one tally and ${b} in another. How many altogether?`,
      (a, b) => `The running score is ${a}, then shifts by ${b}. What score results?`,
      (a, b) => `Two signed amounts are ${a} and ${b}. What is their combined amount?`,
    ],
  },
  multiply: {
    lexical: [
      (a, b) => `What is the product of ${a} and ${b}?`,
      (a, b) => `Compute ${a} times ${b}.`,
      (a, b) => `Scale ${b} by a factor of ${a}.`,
      (a, b) => `Evaluate the product ${a} by ${b}.`,
      (a, b) => `What value results when ${a} is multiplied by ${b}?`,
    ],
    implicit: [
      (a, b) => `A signed rectangle has side values ${a} and ${b}. What is its signed area?`,
      (a, b) => `Apply a scale factor of ${a} to the value ${b}. What results?`,
      (a, b) => `The coefficient ${a} acts on ${b}. What is the resulting value?`,
      (a, b) => `Pair every unit of ${a} with every unit of ${b}. What count results?`,
      (a, b) => `A rate of ${a} is applied across ${b} units. What signed total results?`,
    ],
  },
  "add-rational": {
    lexical: [
      (a, b) => `What is the sum of the fractions ${a} and ${b}?`,
      (a, b) => `Compute ${a} plus ${b} as a reduced fraction.`,
      (a, b) => `Combine the rational values ${a} and ${b}.`,
      (a, b) => `What total fraction results from ${a} and ${b}?`,
      (a, b) => `Give the reduced sum of ${a} with ${b}.`,
    ],
    implicit: [
      (a, b) => `A measure contains ${a} of a unit and then changes by ${b}. What amount remains?`,
      (a, b) => `Place ${a} of a unit together with ${b} of a unit. What fraction results?`,
      (a, b) => `A signed portion is ${a}, followed by another portion ${b}. What is the combined portion?`,
      (a, b) => `On a rational number line, begin at ${a} and move by ${b}. Where do you land?`,
      (a, b) => `Two fractional balances are ${a} and ${b}. What is their joint balance?`,
    ],
  },
  "solve-linear": {
    lexical: [
      (a, b, c) => `Find x such that ${a}*x+${b}=${c}.`,
      (a, b, c) => `Determine the value of x in ${a}*x+${b}=${c}.`,
      (a, b, c) => `What x satisfies ${a}*x+${b}=${c}?`,
      (a, b, c) => `Compute the unknown x for ${a}*x+${b}=${c}.`,
      (a, b, c) => `Identify x when ${a}*x+${b} equals ${c}.`,
    ],
    implicit: [
      (a, b, c) => `Which number can replace x so that ${a}*x+${b}=${c} is true?`,
      (a, b, c) => `A hidden value x makes ${a}*x+${b} equal ${c}. What is it?`,
      (a, b, c) => `The expression ${a}*x+${b} must balance ${c}. Which x works?`,
      (a, b, c) => `Choose x to make both sides of ${a}*x+${b}=${c} match.`,
      (a, b, c) => `What number placed at x makes ${a}*x+${b} land on ${c}?`,
    ],
  },
};

function conversionTemplate(value, mode, stratum, template) {
  const units = {
    "m-to-cm": ["meters", "centimeters", "m", "cm", "length"],
    "cm-to-mm": ["centimeters", "millimeters", "cm", "mm", "length"],
    "kg-to-g": ["kilograms", "grams", "kg", "g", "mass"],
  }[mode];
  assert(units, `unknown conversion ${mode}`);
  const [from, to, shortFrom, shortTo, kind] = units;
  const templates = stratum === "lexical" ? [
    `Express ${value} ${from} in ${to}.`,
    `What is ${value} ${from} measured in ${to}?`,
    `Translate the measurement ${value} ${from} into ${to}.`,
    `Give the equivalent of ${value} ${from} in ${to}.`,
    `Rewrite ${value} ${from} using ${to}.`,
  ] : [
    `The same ${kind} is ${value} ${shortFrom}. What number goes before ${shortTo}?`,
    `A ${kind} reads ${value} ${from}; restate that reading in ${to}.`,
    `Keep the ${kind} unchanged but replace ${shortFrom} with ${shortTo}: ${value} ${shortFrom}.`,
    `A label shows ${value} ${shortFrom}. What would the equivalent ${shortTo} label show?`,
    `For one unchanged ${kind}, ${value} ${from} corresponds to how many ${to}?`,
  ];
  return templates[template];
}

function modelInput(operation, canonical, stratum, template) {
  let match;
  if (operation === "add") {
    match = /^add (-?\d+) (-?\d+)$/.exec(canonical);
  } else if (operation === "multiply") {
    match = /^multiply (-?\d+) (-?\d+)$/.exec(canonical);
  } else if (operation === "add-rational") {
    match = /^add-rational (-?\d+\/\d+) (-?\d+\/\d+)$/.exec(canonical);
  } else if (operation === "convert") {
    match = /^convert (-?\d+) (m-to-cm|cm-to-mm|kg-to-g)$/.exec(canonical);
    assert(match); return clean(conversionTemplate(match[1], match[2], stratum,
      template));
  } else {
    match = /^solve (-?\d+)\*x\+(-?\d+)=(-?\d+)$/.exec(canonical);
  }
  assert(match, `cannot parse canonical input: ${canonical}`);
  return clean(TEMPLATES[operation][stratum][template](...match.slice(1)));
}

function main() {
  assert.equal(sha256(SOURCE), SOURCE_SHA256);
  assert(!fs.existsSync(OUTPUT), `refuse to overwrite ${OUTPUT}`);
  const lines = fs.readFileSync(SOURCE, "utf8").trimEnd().split("\n");
  const header = lines.shift().split("\t");
  const records = lines.map((line) => Object.fromEntries(header.map(
    (name, index) => [name, line.split("\t")[index]])));
  const classIndex = Object.fromEntries(CLASSES.map((name) => [name, 0]));
  const output = [
    "id\tdomain\tprevious_summary\tmodel_input\tcanonical_input\tmodel_request\tbound_request\tartifact\tsummary\tstratum\ttemplate_id"
  ];
  for (const record of records) {
    const operation = record.model_request.slice("quantity.".length);
    assert(CLASSES.includes(operation));
    const index = classIndex[operation]++;
    const stratum = index % 2 === 0 ? "lexical" : "implicit";
    const template = Math.floor(index / 2) % 5;
    const visible = modelInput(operation, record.input, stratum, template);
    output.push([
      `q33-semantic/${operation}/${String(index).padStart(3, "0")}`,
      "quantity", record.previous_summary, visible, record.input,
      record.model_request, record.request, record.artifact, record.summary,
      stratum, template,
    ].join("\t"));
  }
  assert.deepEqual(classIndex, Object.fromEntries(CLASSES.map((name) =>
    [name, 100])));
  fs.mkdirSync("benchmarks/zero4-q33-semantic-v1", { recursive: false });
  fs.writeFileSync(OUTPUT, `${output.join("\n")}\n`, { flag: "wx" });
  console.log(`wrote 500 semantic-routing cases to ${OUTPUT}`);
}

main();
