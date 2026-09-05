import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { ROOT, FIXTURE, BINARY, MODEL_SHA, ARMS, native, armOrder, splitProcess,
  generateCohort, validateResults, sourceBindings, analyze, sha256 } from "./lib/reasoner55_fixed_transfer.mjs";

assert.deepEqual(process.argv.slice(2),["--write"]);
const cohort=generateCohort();
assert.deepEqual(native(["--cohort"]),cohort.records,"independent native family generation");
console.error("All 128 families match independent selection and shortest-length checks.");
const result={schema:"zero.reasoner55_fixed_transfer.v1",model_sha256:MODEL_SHA,
  source_bindings:sourceBindings(),families:cohort.records,arms:ARMS.map(arm=>({arm,rows:null}))};
const timing={schema:"zero.reasoner55_fixed_transfer_timing.v1",passes:12,
  measured_at:new Date().toISOString(),host:{platform:platform(),arch:arch(),release:release(),cpu:cpus()[0]?.model,node:process.version},
  build_flags:process.env.CFLAGS??"-O2 -std=c11 -Wall -Wextra -Wpedantic",
  binary_sha256:sha256(readFileSync(BINARY)),
  memory_scope:"Per-process peak RSS includes cohort preparation, model load, warmup, and search",
  time_scope:"Full existing search and audit pipelines; model loading and training reported separately; JSON output and corpus preparation excluded from episode time",
  training:[],processes:[]};
for(let sample=0;sample<3;sample++) timing.training.push(native(["--training-cost"])[0]);
for(let pass=0;pass<12;pass++) {
  for(const arm of armOrder(pass)) {
    const run=splitProcess(native(["benchmark",arm,String(pass)]),arm,pass);
    const record=result.arms[ARMS.indexOf(arm)];
    if(record.rows===null) record.rows=run.stable;
    else assert.deepEqual(run.stable,record.rows,`fixed results in pass ${pass}, ${arm}`);
    timing.processes.push(run.timing);
  }
  console.error(`Balanced timing pass ${pass+1}/12 complete.`);
}
writeFileSync(resolve(ROOT,"build/reasoner55-fixed-transfer-collected.json"),JSON.stringify({result,timing}));
result.evidence=validateResults(result,cohort,count=>console.error(`Independent replay: ${count}/128 families complete.`));
const analysis=analyze(result,timing);
const resultBytes=`${JSON.stringify(result,null,2)}\n`;
timing.result_sha256=sha256(resultBytes);
const timingBytes=`${JSON.stringify(timing)}\n`;
const report={...analysis,result_sha256:sha256(resultBytes),timing_sha256:sha256(timingBytes)};
mkdirSync(resolve(ROOT,FIXTURE),{recursive:true});
writeFileSync(resolve(ROOT,FIXTURE,"RESULTS.json"),resultBytes);
writeFileSync(resolve(ROOT,FIXTURE,"TIMING.json"),timingBytes);
writeFileSync(resolve(ROOT,FIXTURE,"ANALYSIS.json"),`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify({evidence:result.evidence,decision:report.fixed_cohort_cost_rule,
  arms:report.arms.map(a=>({arm:a.arm,checks:a.totals.verifier_checks,paired:a.paired,totals:a.totals,cost:a.cost,cells:a.cells}))},null,2));
