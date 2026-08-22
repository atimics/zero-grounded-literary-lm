#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  artifact, assert, listFiles, parseNamedArgs, sha256, sha256File,
  stableJson, writeJson,
} from "./zero_data_lib.mjs";

const SPLITS = ["train", "validation", "test"];

function normalize(text) {
  return text.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n")
    .replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

function utf8Bytes(text) { return Buffer.byteLength(text, "utf8"); }

function splitOversize(text, maximumBytes) {
  const pieces = [];
  let rest = text;
  while (utf8Bytes(rest) > maximumBytes) {
    let end = Math.min(rest.length, maximumBytes);
    while (end > 1 && utf8Bytes(rest.slice(0, end)) > maximumBytes) --end;
    const floor = Math.floor(end * 0.72);
    let boundary = Math.max(rest.lastIndexOf("\n", end), rest.lastIndexOf(". ", end));
    if (boundary < floor) boundary = end;
    else if (rest.slice(boundary, boundary + 2) === ". ") boundary += 1;
    pieces.push(rest.slice(0, boundary).trim());
    rest = rest.slice(boundary).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function segmentText(text, limits) {
  const paragraphs = normalize(text).split(/\n{2,}/).map((part) => part.trim())
    .filter(Boolean).flatMap((part) => splitOversize(part, limits.maximum_utf8_bytes));
  const documents = [];
  let pending = [];
  let pendingBytes = 0;
  const flush = () => {
    if (!pending.length) return;
    documents.push(`${pending.join("\n\n").trim()}\n`);
    pending = []; pendingBytes = 0;
  };
  for (const paragraph of paragraphs) {
    const bytes = utf8Bytes(paragraph) + (pending.length ? 2 : 0);
    if (pending.length && (pendingBytes + bytes > limits.maximum_utf8_bytes ||
      pendingBytes >= limits.target_utf8_bytes)) flush();
    pending.push(paragraph); pendingBytes += bytes;
  }
  flush();
  if (documents.length > 1 && utf8Bytes(documents.at(-1)) < limits.minimum_utf8_bytes) {
    const tail = documents.pop();
    if (utf8Bytes(documents.at(-1)) + utf8Bytes(tail) <= limits.maximum_utf8_bytes)
      documents[documents.length - 1] = `${documents.at(-1).trim()}\n\n${tail}`;
    else documents.push(tail);
  }
  return documents;
}

function words(text) {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
}

function shingles(text, size) {
  const tokens = words(text);
  const result = [];
  for (let index = 0; index + size <= tokens.length; ++index)
    result.push(tokens.slice(index, index + size).join(" "));
  return result;
}

export function simhash(text, shingleSize) {
  const vector = Array(64).fill(0);
  const unique = new Set(shingles(text, shingleSize));
  for (const item of unique) {
    const digest = BigInt(`0x${sha256(item).slice(0, 16)}`);
    for (let bit = 0; bit < 64; ++bit)
      vector[bit] += (digest & (1n << BigInt(bit))) ? 1 : -1;
  }
  return vector.reduce((value, score, bit) =>
    score >= 0 ? value | (1n << BigInt(bit)) : value, 0n);
}

export function hamming(left, right) {
  let value = left ^ right;
  let count = 0;
  while (value) { value &= value - 1n; ++count; }
  return count;
}

export class SimHashIndex {
  constructor(maximumDistance) {
    assert(Number.isInteger(maximumDistance) && maximumDistance >= 0 && maximumDistance < 64,
      "invalid SimHash distance");
    this.maximumDistance = maximumDistance;
    this.bandCount = maximumDistance + 1;
    this.buckets = new Map();
    this.fingerprints = [];
  }

  keys(fingerprint) {
    const keys = [];
    for (let band = 0; band < this.bandCount; ++band) {
      const start = Math.floor(64 * band / this.bandCount);
      const end = Math.floor(64 * (band + 1) / this.bandCount);
      const width = end - start;
      const mask = (1n << BigInt(width)) - 1n;
      keys.push(`${band}:${(fingerprint >> BigInt(start)) & mask}`);
    }
    return keys;
  }

  find(fingerprint) {
    const candidates = new Set();
    for (const key of this.keys(fingerprint))
      for (const index of this.buckets.get(key) ?? []) candidates.add(index);
    for (const index of [...candidates].sort((left, right) => left - right)) {
      if (hamming(this.fingerprints[index], fingerprint) <= this.maximumDistance) return index;
    }
    return -1;
  }

  add(fingerprint) {
    const index = this.fingerprints.length;
    this.fingerprints.push(fingerprint);
    for (const key of this.keys(fingerprint)) {
      const members = this.buckets.get(key) ?? [];
      members.push(index); this.buckets.set(key, members);
    }
  }
}

function assignSplits(documents, registry) {
  for (const sourceId of new Set(documents.map((document) => document.source_id))) {
    const source = documents.filter((document) => document.source_id === sourceId)
      .sort((left, right) => sha256(`${registry.split_seed}\0${left.id}`)
        .localeCompare(sha256(`${registry.split_seed}\0${right.id}`)));
    const reserve = source.length >= 3;
    const testCount = reserve ? Math.max(1, Math.round(source.length *
      registry.splits.test_permyriad / 10000)) : 0;
    const validationCount = reserve ? Math.max(1, Math.round(source.length *
      registry.splits.validation_permyriad / 10000)) : 0;
    source.forEach((document, index) => {
      document.split = index < testCount ? "test" :
        index < testCount + validationCount ? "validation" : "train";
    });
  }
}

function readPanel(panel) {
  const lines = fs.readFileSync(panel.path, "utf8").trimEnd().split("\n");
  const header = lines.shift().split("\t");
  const column = header.indexOf(panel.text_column);
  assert(column >= 0, `${panel.path} has no ${panel.text_column} column`);
  return lines.map((line, index) => ({
    id: `${panel.id}/${index}`,
    text: line.split("\t")[column].trim(),
  })).filter((record) => record.text);
}

function contaminationAudit(documents, panels) {
  const auditSize = 12;
  const lookup = new Map();
  for (const panel of panels) for (const record of readPanel(panel)) {
    for (const item of new Set(shingles(record.text, auditSize))) {
      const records = lookup.get(item) ?? [];
      records.push(record.id); lookup.set(item, records);
    }
  }
  const matches = [];
  for (const document of documents) for (const item of new Set(shingles(document.text, auditSize))) {
    if (!lookup.has(item)) continue;
    matches.push({ document_id: document.id, panel_records: lookup.get(item), shingle: item });
  }
  return { shingle_size: auditSize, panel_records: panels.reduce((sum, panel) =>
    sum + readPanel(panel).length, 0), matches };
}

function validateRegistry(registry) {
  assert(registry.schema === "zero.corpus_sources.v1", "unsupported registry schema");
  assert(registry.sources.length > 0, "registry must contain sources");
  assert(new Set(registry.sources.map((source) => source.id)).size === registry.sources.length,
    "source ids must be unique");
  assert(registry.splits.train_permyriad + registry.splits.validation_permyriad +
    registry.splits.test_permyriad === 10000, "split allocation must total 10000");
  assert(registry.documents.minimum_utf8_bytes <= registry.documents.target_utf8_bytes &&
    registry.documents.target_utf8_bytes <= registry.documents.maximum_utf8_bytes,
    "document limits are inconsistent");
}

function tokenize(tokenizerBin, vocab, input, output) {
  const result = spawnSync(tokenizerBin,
    ["--vocab", vocab, "--text", input, "--out", output],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(
    `tokenizer failed for ${input}: ${result.stderr || result.stdout}`);
}

function shardTokens(input, outputDirectory, prefix, maximumBytes) {
  const data = fs.readFileSync(input);
  assert(data.length % 2 === 0, `${input} is not a uint16 token stream`);
  const alignedMaximum = Math.floor(maximumBytes / 2) * 2;
  const artifacts = [];
  for (let offset = 0, index = 0; offset < data.length; offset += alignedMaximum, ++index) {
    const name = `${prefix}-${String(index).padStart(5, "0")}.tok`;
    const output = path.join(outputDirectory, name);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(output, data.subarray(offset, Math.min(offset + alignedMaximum, data.length)));
    artifacts.push({ path: output, tokens: fs.statSync(output).size / 2 });
  }
  return artifacts;
}

export function build(options) {
  const registryPath = path.resolve(options.registry);
  const outputRoot = path.resolve(options.out);
  assert(!fs.existsSync(outputRoot), `refusing to overwrite existing output ${outputRoot}`);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  validateRegistry(registry);
  for (const binding of [registry.tokenizer, ...registry.sources,
    ...registry.contamination_panels]) {
    assert(fs.existsSync(binding.path), `missing bound input ${binding.path}`);
    assert(sha256File(binding.path) === binding.sha256, `${binding.path} digest drifted`);
  }
  if (registry.acquisition_plan) {
    assert(fs.existsSync(registry.acquisition_plan),
      `missing acquisition plan ${registry.acquisition_plan}`);
    assert(sha256File(registry.acquisition_plan) === registry.acquisition_plan_sha256,
      `${registry.acquisition_plan} digest drifted`);
  }
  for (const source of registry.sources) if (source.attribution_path) {
    assert(fs.existsSync(source.attribution_path),
      `missing attribution index ${source.attribution_path}`);
    assert(sha256File(source.attribution_path) === source.attribution_sha256,
      `${source.attribution_path} digest drifted`);
  }
  assert(fs.existsSync(options.tokenizer_bin),
    `missing tokenizer binary ${options.tokenizer_bin}; run make bpe_tokenizer`);
  fs.mkdirSync(outputRoot, { recursive: true });

  const exact = new Map();
  const kept = [];
  const exactDuplicates = [];
  const nearDuplicates = [];
  const sourceStats = [];
  const nearIndex = new SimHashIndex(registry.deduplication.simhash_max_hamming_distance);
  for (const source of registry.sources) {
    const original = fs.readFileSync(source.path, "utf8");
    const normalized = normalize(original);
    const sourceCopy = path.join(outputRoot, "sources", `${source.id}.txt`);
    fs.mkdirSync(path.dirname(sourceCopy), { recursive: true });
    fs.writeFileSync(sourceCopy, normalized);
    let attribution = null;
    if (source.attribution_path) {
      const attributionCopy = path.join(outputRoot, "attribution", `${source.id}.jsonl`);
      fs.mkdirSync(path.dirname(attributionCopy), { recursive: true });
      fs.copyFileSync(source.attribution_path, attributionCopy);
      const records = fs.readFileSync(attributionCopy, "utf8").split("\n").filter(Boolean).length;
      attribution = { artifact: path.relative(outputRoot, attributionCopy).split(path.sep).join("/"),
        records, sha256: sha256File(attributionCopy) };
    }
    const pieces = segmentText(normalized, registry.documents);
    let accepted = 0;
    for (let ordinal = 0; ordinal < pieces.length; ++ordinal) {
      const text = pieces[ordinal];
      const contentSha = sha256(text);
      const id = `${source.id}/${String(ordinal).padStart(6, "0")}/${contentSha.slice(0, 16)}`;
      if (exact.has(contentSha)) {
        exactDuplicates.push({ discarded_id: id, retained_id: exact.get(contentSha) });
        continue;
      }
      const fingerprint = simhash(text, registry.deduplication.word_shingle_size);
      const nearOrdinal = nearIndex.find(fingerprint);
      if (nearOrdinal >= 0) {
        const near = kept[nearOrdinal];
        nearDuplicates.push({ discarded_id: id, retained_id: near.id,
          hamming_distance: hamming(near.fingerprint, fingerprint) });
        continue;
      }
      const document = { id, source_id: source.id, ordinal, sha256: contentSha,
        bytes: utf8Bytes(text), words: words(text).length, text, fingerprint };
      exact.set(contentSha, id); nearIndex.add(fingerprint); kept.push(document); ++accepted;
    }
    sourceStats.push({ id: source.id, input_bytes: utf8Bytes(original),
      normalized_bytes: utf8Bytes(normalized), candidate_documents: pieces.length,
      retained_documents: accepted, sampling_weight: source.sampling_weight,
      ...(registry.acquisition_plan ? { title: source.title, origin_url: source.origin_url,
        license: source.license } : {}),
      ...(registry.acquisition_plan && source.license_url ? { license_url: source.license_url } : {}),
      ...(attribution ? { attribution } : {}) });
  }

  const contamination = contaminationAudit(kept, registry.contamination_panels);
  assert(contamination.matches.length === 0,
    `contamination gate failed with ${contamination.matches.length} matching shingles`);
  assignSplits(kept, registry);
  for (const split of SPLITS)
    assert(kept.some((document) => document.split === split), `${split} split is empty`);

  const splitManifest = {};
  for (const split of SPLITS) {
    const records = kept.filter((document) => document.split === split)
      .sort((left, right) => left.id.localeCompare(right.id));
    const jsonlPath = path.join(outputRoot, "documents", `${split}.jsonl`);
    fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
    fs.writeFileSync(jsonlPath, records.map((document) => stableJson({
      id: document.id, source_id: document.source_id, ordinal: document.ordinal,
      sha256: document.sha256, bytes: document.bytes, words: document.words,
      text: document.text,
    }, 0).trimEnd()).join("\n") + "\n");
    const sources = [];
    for (const source of registry.sources) {
      const selected = records.filter((document) => document.source_id === source.id);
      if (!selected.length) continue;
      const textPath = path.join(outputRoot, "text", split, `${source.id}.txt`);
      fs.mkdirSync(path.dirname(textPath), { recursive: true });
      fs.writeFileSync(textPath, selected.map((document) => document.text.trimEnd()).join("\n\n") + "\n");
      const temporaryTokens = path.join(os.tmpdir(),
        `zero-corpus-${process.pid}-${split}-${source.id}.tok`);
      tokenize(options.tokenizer_bin, registry.tokenizer.path, textPath, temporaryTokens);
      const shards = shardTokens(temporaryTokens, path.join(outputRoot, "tokens", split),
        source.id, Number(options.max_shard_bytes));
      fs.rmSync(temporaryTokens);
      sources.push({ source_id: source.id, sampling_weight: source.sampling_weight,
        documents: selected.length, utf8_bytes: selected.reduce((sum, item) => sum + item.bytes, 0),
        tokens: shards.reduce((sum, item) => sum + item.tokens, 0),
        shards: shards.map((item) => path.relative(outputRoot, item.path).split(path.sep).join("/")) });
    }
    splitManifest[split] = {
      documents: records.length,
      utf8_bytes: records.reduce((sum, item) => sum + item.bytes, 0),
      words: records.reduce((sum, item) => sum + item.words, 0),
      sources,
    };
  }

  writeJson(path.join(outputRoot, "reports", "deduplication.json"), {
    schema: "zero.deduplication_report.v1", candidates: kept.length + exactDuplicates.length +
      nearDuplicates.length, retained: kept.length, exact_duplicates: exactDuplicates,
    near_duplicates: nearDuplicates,
  });
  writeJson(path.join(outputRoot, "reports", "contamination.json"), {
    schema: "zero.contamination_report.v1", ...contamination,
  });
  writeJson(path.join(outputRoot, "reports", "quality.json"), {
    schema: "zero.corpus_quality_report.v1", sources: sourceStats,
    totals: { documents: kept.length, utf8_bytes: kept.reduce((sum, item) => sum + item.bytes, 0),
      words: kept.reduce((sum, item) => sum + item.words, 0), exact_duplicates: exactDuplicates.length,
      near_duplicates: nearDuplicates.length, contamination_matches: contamination.matches.length },
  });
  fs.copyFileSync(registryPath, path.join(outputRoot, "source-registry.json"));
  fs.copyFileSync(registry.tokenizer.path, path.join(outputRoot, "tokenizer.bpe"));

  const artifactPaths = listFiles(outputRoot).filter((file) =>
    !["manifest.json", "READY"].includes(file));
  const artifacts = artifactPaths.map((file) => artifact(outputRoot, file));
  const manifestBody = {
    schema: "zero.dataset_manifest.v1", dataset_id: registry.dataset_id,
    version: registry.version, release_date: registry.release_date,
    registry: artifact(outputRoot, "source-registry.json"),
    tokenizer: { ...registry.tokenizer, artifact: "tokenizer.bpe" },
    build: { implementation: "zero-corpus-builder-v1", deterministic: true,
      split_seed: registry.split_seed, document_limits: registry.documents,
      deduplication: registry.deduplication,
      ...(registry.acquisition_plan ? { acquisition_plan: registry.acquisition_plan,
        acquisition_plan_sha256: registry.acquisition_plan_sha256,
        extractor: registry.extractor } : {}) },
    sources: sourceStats, splits: splitManifest,
    quality: { passed: true, exact_duplicates_removed: exactDuplicates.length,
      near_duplicates_removed: nearDuplicates.length, contamination_matches: 0 },
    artifacts,
  };
  const datasetDigest = sha256(stableJson(manifestBody, 0));
  writeJson(path.join(outputRoot, "manifest.json"),
    { ...manifestBody, dataset_digest: datasetDigest });
  writeJson(path.join(outputRoot, "READY"), {
    schema: "zero.dataset_ready.v1", dataset_id: registry.dataset_id,
    version: registry.version, dataset_digest: datasetDigest,
    manifest_sha256: sha256File(path.join(outputRoot, "manifest.json")),
  });
  return { outputRoot, datasetDigest, manifest: { ...manifestBody, dataset_digest: datasetDigest } };
}

function main() {
  const options = parseNamedArgs(process.argv, {
    registry: "corpus/registry/zero-literary-v1.json",
    out: "build/zero-literary-v1",
    tokenizer_bin: "./bpe_tokenizer",
    max_shard_bytes: String(64 * 1024 * 1024),
  });
  const result = build(options);
  console.log(`sealed ${result.manifest.dataset_id}/${result.manifest.version}`);
  console.log(`dataset digest ${result.datasetDigest}`);
  console.log(`documents ${Object.values(result.manifest.splits).reduce((sum, split) => sum + split.documents, 0)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
