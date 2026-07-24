#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HEADER = [
  "id", "benchmark", "group", "kind", "gold", "context",
  "choice0", "choice1", "choice2", "choice3",
].join("\t");
const CONTEXT_BYTES = 511;
const TINYSTORIES_CASES = 1000;
const TINYSTORIES_WINDOW_BYTES = 512;

function fail(message) {
  throw new Error(message);
}

function sha256(dataOrFile, file = true) {
  const hash = crypto.createHash("sha256");
  hash.update(file ? fs.readFileSync(dataOrFile) : dataOrFile);
  return hash.digest("hex");
}

function normalize(text, stats) {
  const replacements = new Map([
    ["\u2018", "'"], ["\u2019", "'"], ["\u201c", "\""], ["\u201d", "\""],
    ["\u2013", "-"], ["\u2014", "-"], ["\u2026", "..."],
  ]);
  let output = "";
  let whitespace = false;
  for (const original of String(text).normalize("NFKD")) {
    let character = replacements.get(original) ?? original;
    if (/[\u0300-\u036f]/u.test(character)) {
      stats.combining_marks_removed += 1;
      continue;
    }
    if (/\s/u.test(character)) {
      if (!whitespace && output.length > 0) output += " ";
      whitespace = true;
      continue;
    }
    whitespace = false;
    for (const unit of character) {
      const code = unit.charCodeAt(0);
      if (code >= 32 && code < 127) {
        output += unit;
      } else {
        output += "?";
        stats.non_ascii_replaced += 1;
      }
    }
  }
  return output.trim();
}

function preprocessHellaswag(text) {
  return text.trim()
    .replaceAll(" [title]", ". ")
    .replace(/\[.*?\]/gu, "")
    .replaceAll("  ", " ");
}

function capitalize(text) {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function truncateContext(text, stats) {
  if (text.length <= CONTEXT_BYTES) return text;
  stats.contexts_truncated += 1;
  stats.context_bytes_removed += text.length - CONTEXT_BYTES;
  return text.slice(-CONTEXT_BYTES);
}

function cleanField(text) {
  if (/[\t\r\n]/u.test(text)) fail("prepared field contains forbidden whitespace");
  return text;
}

function row({ id, benchmark, group, kind, gold, context = "", choices }) {
  if (!Array.isArray(choices) || choices.length < 1 || choices.length > 4) {
    fail(`invalid choices for ${id}`);
  }
  const fields = [
    id, benchmark, group, kind, String(gold), context,
    ...choices, ...Array(4 - choices.length).fill(""),
  ].map(cleanField);
  return fields.join("\t");
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function writeDataset(output, name, rows, metadata) {
  const file = path.join(output, `${name}.tsv`);
  const contents = `${HEADER}\n${rows.join("\n")}\n`;
  fs.writeFileSync(file, contents);
  return {
    path: path.basename(file),
    sha256: sha256(file),
    bytes: fs.statSync(file).size,
    cases: rows.length,
    ...metadata,
  };
}

function prepareBlimp(source, output, stats) {
  const files = fs.readdirSync(source)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  if (files.length !== 67) fail(`expected 67 BLiMP paradigms, found ${files.length}`);
  const rows = [];
  for (const name of files) {
    const records = readJsonl(path.join(source, name));
    if (records.length !== 1000) fail(`${name} does not contain 1000 pairs`);
    for (const record of records) {
      const group = String(record.UID);
      if (group !== name.replace(/\.jsonl$/u, "")) fail(`${name} UID drifted`);
      rows.push(row({
        id: `blimp/${group}/${record.pairID}`,
        benchmark: "blimp",
        group,
        kind: "pair",
        gold: 0,
        choices: [
          ` ${normalize(record.sentence_good, stats)}`,
          ` ${normalize(record.sentence_bad, stats)}`,
        ],
      }));
    }
  }
  return writeDataset(output, "blimp", rows, { groups: files.length });
}

function prepareHellaswag(source, output, stats) {
  const records = readJsonl(source);
  const rows = records.map((record, index) => {
    const query = preprocessHellaswag(
      `${record.activity_label}: ${record.ctx_a} ${capitalize(record.ctx_b)}`,
    );
    const context = truncateContext(normalize(query, stats), stats);
    const choices = record.endings.map(
      (choice) => ` ${normalize(preprocessHellaswag(choice), stats)}`,
    );
    if (choices.length !== 4 || !Number.isInteger(record.label)) {
      fail(`invalid HellaSwag record ${index}`);
    }
    return row({
      id: `hellaswag/${record.ind}`,
      benchmark: "hellaswag",
      group: record.split_type,
      kind: "multiple_choice",
      gold: record.label,
      context,
      choices,
    });
  });
  return writeDataset(output, "hellaswag", rows, { groups: 2 });
}

function prepareLambada(source, output, stats) {
  const records = readJsonl(source);
  const rows = records.map((record, index) => {
    const text = normalize(record.text, stats);
    const boundary = text.lastIndexOf(" ");
    if (boundary <= 0 || boundary === text.length - 1) fail(`invalid LAMBADA ${index}`);
    return row({
      id: `lambada/${index}`,
      benchmark: "lambada_openai",
      group: "test",
      kind: "cloze",
      gold: 0,
      context: truncateContext(text.slice(0, boundary), stats),
      choices: [text.slice(boundary)],
    });
  });
  return writeDataset(output, "lambada", rows, { groups: 1 });
}

function prepareTinyStories(source, output, stats) {
  const stories = fs.readFileSync(source, "utf8")
    .split("<|endoftext|>")
    .map((story) => normalize(story, stats))
    .filter((story) => story.length >= 128);
  const ranked = stories.map((story, index) => ({
    story,
    index,
    rank: sha256(`${index}\0${story}`, false),
  })).sort((left, right) => left.rank.localeCompare(right.rank));
  if (ranked.length < TINYSTORIES_CASES) fail("not enough TinyStories validation records");
  const rows = ranked.slice(0, TINYSTORIES_CASES).map(({ story, index, rank }) => {
    const maximum = Math.max(0, story.length - TINYSTORIES_WINDOW_BYTES);
    const offset = maximum === 0
      ? 0
      : Number.parseInt(rank.slice(0, 12), 16) % (maximum + 1);
    const window = story.slice(offset, offset + TINYSTORIES_WINDOW_BYTES);
    return row({
      id: `tinystories/${index}/${offset}`,
      benchmark: "tinystories",
      group: "validation",
      kind: "rolling",
      gold: 0,
      choices: [window],
    });
  });
  return writeDataset(output, "tinystories", rows, {
    groups: 1,
    source_stories: stories.length,
    selection: "lowest sha256(index + NUL + normalized_story), first 1000",
    window_bytes: TINYSTORIES_WINDOW_BYTES,
  });
}

export function prepare(options) {
  const contract = JSON.parse(fs.readFileSync(options.contract, "utf8"));
  const expectedSources = Object.fromEntries(
    contract.sources.map((source) => [source.id, source]),
  );
  for (const [id, file] of [
    ["blimp_zip", options.blimpZip],
    ["hellaswag_validation", options.hellaswag],
    ["lambada_openai_test", options.lambada],
    ["tinystories_validation", options.tinystories],
  ]) {
    if (!fs.existsSync(file)) fail(`missing ${id}: ${file}`);
    if (sha256(file) !== expectedSources[id]?.sha256) fail(`${id} source hash mismatch`);
  }
  fs.mkdirSync(options.output, { recursive: true });
  const stats = {
    non_ascii_replaced: 0,
    combining_marks_removed: 0,
    contexts_truncated: 0,
    context_bytes_removed: 0,
  };
  const datasets = {
    blimp: prepareBlimp(options.blimpDirectory, options.output, stats),
    hellaswag: prepareHellaswag(options.hellaswag, options.output, stats),
    lambada: prepareLambada(options.lambada, options.output, stats),
    tinystories: prepareTinyStories(options.tinystories, options.output, stats),
  };
  const manifest = {
    schema: "zero.external_eval_bundle.v1",
    id: contract.id,
    contract_sha256: sha256(options.contract),
    normalization: contract.normalization,
    sources: contract.sources,
    datasets,
    normalization_stats: stats,
  };
  const manifestPath = path.join(options.output, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function selfTest() {
  const stats = {
    non_ascii_replaced: 0,
    combining_marks_removed: 0,
    contexts_truncated: 0,
    context_bytes_removed: 0,
  };
  if (normalize("  “café”\n— yes  ", stats) !== "\"cafe\" - yes") {
    fail("normalization self-test failed");
  }
  if (truncateContext("x".repeat(600), stats).length !== CONTEXT_BYTES) {
    fail("truncation self-test failed");
  }
  if (!row({
    id: "x", benchmark: "b", group: "g", kind: "pair", gold: 0,
    choices: [" good", " bad"],
  }).endsWith("\t\t")) {
    fail("row self-test failed");
  }
  console.log("ZERO-EVAL-1 preparation self-test passed");
}

function parseArguments(args) {
  const options = {
    contract: "benchmarks/zero-eval-1/contract.json",
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (key === "--self-test") return { selfTest: true };
    const value = args[index + 1];
    if (value === undefined) fail(`missing value for ${key}`);
    if (key === "--contract") options.contract = value;
    else if (key === "--blimp-zip") options.blimpZip = value;
    else if (key === "--blimp-directory") options.blimpDirectory = value;
    else if (key === "--hellaswag") options.hellaswag = value;
    else if (key === "--lambada") options.lambada = value;
    else if (key === "--tinystories") options.tinystories = value;
    else if (key === "--output") options.output = value;
    else fail(`unknown argument ${key}`);
  }
  for (const required of [
    "blimpZip", "blimpDirectory", "hellaswag", "lambada", "tinystories", "output",
  ]) {
    if (!options[required]) fail(`missing --${required}`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) selfTest();
  else console.log(JSON.stringify(prepare(options), null, 2));
}
