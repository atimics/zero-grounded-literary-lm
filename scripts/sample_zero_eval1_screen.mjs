#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BASE_CONTRACT = "benchmarks/zero-eval-1/contract.json";
const SCREEN_CASES = 1000;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(value, isFile = true) {
  return crypto.createHash("sha256")
    .update(isFile ? fs.readFileSync(value) : value)
    .digest("hex");
}

function readDataset(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/\n$/u, "").split("\n");
  const header = lines.shift();
  const rows = lines.map((line, ordinal) => {
    const fields = line.split("\t");
    assert(fields.length === 10, `${file}:${ordinal + 2} field count drifted`);
    return {
      line,
      ordinal,
      id: fields[0],
      group: fields[2],
      rank: sha256(`${fields[0]}\0${line}`, false),
    };
  });
  return { header, rows };
}

function largestRemainderQuotas(groupCounts, total) {
  const entries = Object.entries(groupCounts).sort(([left], [right]) =>
    left.localeCompare(right));
  const population = entries.reduce((sum, [, count]) => sum + count, 0);
  const quotas = {};
  const remainders = [];
  let assigned = 0;
  for (const [group, count] of entries) {
    const exact = total * count / population;
    const base = Math.floor(exact);
    quotas[group] = base;
    assigned += base;
    remainders.push({ group, remainder: exact - base });
  }
  remainders.sort((left, right) =>
    right.remainder - left.remainder || left.group.localeCompare(right.group));
  for (let index = 0; index < total - assigned; ++index) {
    quotas[remainders[index].group] += 1;
  }
  return quotas;
}

function selectByGroup(rows, quotas) {
  const groups = {};
  for (const row of rows) (groups[row.group] ??= []).push(row);
  assert(
    JSON.stringify(Object.keys(groups).sort()) ===
      JSON.stringify(Object.keys(quotas).sort()),
    "selection groups drifted",
  );
  const selected = [];
  for (const [group, quota] of Object.entries(quotas)) {
    const candidates = groups[group].sort((left, right) =>
      left.rank.localeCompare(right.rank) || left.ordinal - right.ordinal);
    assert(quota > 0 && candidates.length >= quota, `${group} quota is invalid`);
    selected.push(...candidates.slice(0, quota));
  }
  return selected.sort((left, right) => left.ordinal - right.ordinal);
}

function blimpQuotas(rows) {
  const groups = [...new Set(rows.map(({ group }) => group))].sort();
  assert(groups.length === 67, "BLiMP group count drifted");
  const base = Math.floor(SCREEN_CASES / groups.length);
  const remainder = SCREEN_CASES - base * groups.length;
  const extra = new Set(
    groups.map((group) => ({
      group,
      rank: sha256(`blimp-group\0${group}`, false),
    })).sort((left, right) =>
      left.rank.localeCompare(right.rank) || left.group.localeCompare(right.group))
      .slice(0, remainder)
      .map(({ group }) => group),
  );
  return Object.fromEntries(groups.map((group) => [
    group,
    base + (extra.has(group) ? 1 : 0),
  ]));
}

function proportionalQuotas(rows) {
  const counts = {};
  for (const row of rows) counts[row.group] = (counts[row.group] ?? 0) + 1;
  return largestRemainderQuotas(counts, SCREEN_CASES);
}

function selectGlobal(rows, count) {
  assert(rows.length >= count, "global sample is larger than its source");
  return [...rows].sort((left, right) =>
    left.rank.localeCompare(right.rank) || left.ordinal - right.ordinal)
    .slice(0, count)
    .sort((left, right) => left.ordinal - right.ordinal);
}

function writeSample(output, id, source, header, selected, selection, quotas = null) {
  const destination = path.join(output, `${id}.tsv`);
  fs.writeFileSync(
    destination,
    `${header}\n${selected.map(({ line }) => line).join("\n")}\n`,
  );
  const groups = {};
  for (const row of selected) groups[row.group] = (groups[row.group] ?? 0) + 1;
  return {
    path: path.basename(destination),
    sha256: sha256(destination),
    bytes: fs.statSync(destination).size,
    cases: selected.length,
    source_sha256: sha256(source),
    selection,
    group_quotas: quotas,
    selected_group_counts: Object.fromEntries(
      Object.entries(groups).sort(([left], [right]) => left.localeCompare(right)),
    ),
    selected_ordinals_sha256: sha256(
      `${selected.map(({ ordinal }) => ordinal).join("\n")}\n`,
      false,
    ),
  };
}

export function sample(bundle, output) {
  const contract = JSON.parse(fs.readFileSync(BASE_CONTRACT, "utf8"));
  fs.mkdirSync(output, { recursive: true });
  const datasets = {};
  for (const id of ["blimp", "tinystories", "hellaswag", "lambada"]) {
    const expected = contract.prepared_bundle.datasets[id];
    const source = path.join(bundle, expected.path);
    assert(fs.existsSync(source), `${id} source is unavailable`);
    assert(sha256(source) === expected.sha256, `${id} source hash mismatch`);
    assert(fs.statSync(source).size === expected.bytes, `${id} source size mismatch`);
    const { header, rows } = readDataset(source);
    assert(rows.length === expected.cases, `${id} source case count mismatch`);

    if (id === "blimp") {
      const quotas = blimpQuotas(rows);
      datasets[id] = writeSample(
        output,
        id,
        source,
        header,
        selectByGroup(rows, quotas),
        "14 cases from every paradigm plus one extra case from 62 hash-ranked paradigms; lowest sha256(id + NUL + row) within each paradigm",
        quotas,
      );
    } else if (id === "hellaswag") {
      const quotas = proportionalQuotas(rows);
      datasets[id] = writeSample(
        output,
        id,
        source,
        header,
        selectByGroup(rows, quotas),
        "largest-remainder proportional split quotas; lowest sha256(id + NUL + row) within each split",
        quotas,
      );
    } else if (id === "lambada") {
      datasets[id] = writeSample(
        output,
        id,
        source,
        header,
        selectGlobal(rows, SCREEN_CASES),
        "lowest sha256(id + NUL + row), first 1000",
      );
    } else {
      assert(rows.length === SCREEN_CASES, "TinyStories screen must retain the full sample");
      datasets[id] = writeSample(
        output,
        id,
        source,
        header,
        rows,
        "all 1000 frozen TinyStories cases",
      );
    }
  }
  const manifest = {
    schema: "zero.external_eval_screen_bundle.v1",
    id: "zero-eval-1-screen-v1",
    base_contract_sha256: sha256(BASE_CONTRACT),
    datasets,
  };
  fs.writeFileSync(
    path.join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function selfTest() {
  const quotas = largestRemainderQuotas({ indomain: 5001, zeroshot: 5041 }, 1000);
  assert(
    quotas.indomain === 498 && quotas.zeroshot === 502,
    "largest-remainder quota self-test failed",
  );
  const groups = Array.from({ length: 67 }, (_, index) => `g${index}`);
  const rows = groups.flatMap((group, groupIndex) =>
    Array.from({ length: 20 }, (_, rowIndex) => ({
      group,
      ordinal: groupIndex * 20 + rowIndex,
      rank: sha256(`${group}/${rowIndex}`, false),
    })));
  const selected = selectByGroup(rows, blimpQuotas(rows));
  assert(
    selected.length === SCREEN_CASES &&
      new Set(selected.map(({ ordinal }) => ordinal)).size === SCREEN_CASES,
    "BLiMP stratification self-test failed",
  );
  console.log("ZERO-EVAL-1 screen sampling self-test passed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const bundleIndex = process.argv.indexOf("--bundle");
    const outputIndex = process.argv.indexOf("--output");
    if (bundleIndex < 0 || outputIndex < 0) {
      fail("usage: sample_zero_eval1_screen.mjs --bundle DIR --output DIR");
    }
    console.log(JSON.stringify(
      sample(process.argv[bundleIndex + 1], process.argv[outputIndex + 1]),
      null,
      2,
    ));
  }
}
