import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { ROOT, FIXTURE, BINARIES, sha256, bytes, nativeJSON, conditionOrder,
  readReference, makeResult, runCondition, analyze } from "./lib/reasoner55_fast_search.mjs";

assert.deepEqual(process.argv.slice(2),["--write"]);
const reference=readReference(),result=makeResult(reference);
const resultBytes=bytes(result);
const timing={schema:"zero.reasoner55_fast_search_timing.v1",passes:16,
  result_sha256:sha256(resultBytes),measured_at:new Date().toISOString(),
  host:{platform:platform(),arch:arch(),release:release(),cpu:cpus()[0]?.model,node:process.version},
  compiler:execFileSync(process.env.CC??"cc",["--version"],{encoding:"utf8"}).trim(),
  build_flags:process.env.CFLAGS??"-O2 -std=c11 -Wall -Wextra -Wpedantic",
  time_scope:"Full search and audit pipeline; preparation, model loading and JSON output have separate scopes",
  memory_scope:"Per-process peak RSS includes corpus preparation, model loading, warmup and search",
  binaries:Object.fromEntries(Object.entries(BINARIES).map(([id,path])=>[id,{
    path,sha256:sha256(readFileSync(resolve(ROOT,path))),
    backend:id==="original"?{hash:"original portable SHA-256",sort:"original qsort",buffer_bytes:0}:nativeJSON(id,["--backend"])[0]}])),
  processes:[]};
for (let pass=0;pass<16;pass++) {
  for (const condition of conditionOrder(pass)) timing.processes.push(runCondition(condition,pass,reference));
  writeFileSync(resolve(ROOT,"build/reasoner55-fast-collected.json"),JSON.stringify({result,timing}));
  console.error(`Speed pass ${pass+1}/16: all 4096 result rows match the fixed benchmark.`);
}
const analysis=analyze(result,timing,reference),timingBytes=`${JSON.stringify(timing)}\n`;
const report={...analysis,result_sha256:sha256(resultBytes),timing_sha256:sha256(timingBytes)};
mkdirSync(resolve(ROOT,FIXTURE),{recursive:true});
writeFileSync(resolve(ROOT,FIXTURE,"RESULTS.json"),resultBytes);
writeFileSync(resolve(ROOT,FIXTURE,"TIMING.json"),timingBytes);
writeFileSync(resolve(ROOT,FIXTURE,"ANALYSIS.json"),bytes(report));
console.log(JSON.stringify({decision:report.engineering_check,comparisons:report.comparisons.map(c=>
  ({condition:c.condition,reference:c.reference,paired:c.paired,cells:c.cells}))},null,2));
