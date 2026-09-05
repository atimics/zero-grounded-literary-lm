import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, FIXTURE, BINARY, MODEL_SHA, ARMS, native, splitProcess, generateCohort,
  validateResults, loadModel, sourceBindings, analyze, sha256, armOrder, trainModel } from "./lib/reasoner55_fixed_transfer.mjs";

const read=name=>readFileSync(resolve(ROOT,FIXTURE,name));
const resultBytes=read("RESULTS.json"),timingBytes=read("TIMING.json");
const result=JSON.parse(resultBytes),timing=JSON.parse(timingBytes),analysis=JSON.parse(read("ANALYSIS.json"));
assert.deepEqual(result.source_bindings,sourceBindings());
assert.equal(timing.schema,"zero.reasoner55_fixed_transfer_timing.v1");
assert.equal(timing.result_sha256,sha256(resultBytes));
assert.match(timing.binary_sha256,/^[0-9a-f]{64}$/u);
assert.ok(Number.isFinite(Date.parse(timing.measured_at)));
assert.ok(timing.host.platform && timing.host.arch && timing.host.cpu && timing.build_flags);
const cohort=generateCohort();
assert.deepEqual(native(["--cohort"]),cohort.records);
assert.deepEqual(validateResults(result,cohort),result.evidence);
const trained=trainModel(),loaded=loadModel();
assert.equal(trained.artifact_sha256,MODEL_SHA);
assert.deepEqual(trained.weights,loaded.weights); assert.deepEqual(trained.guides,loaded.guides);
for(const arm of ARMS) {
  const run=splitProcess(native(["benchmark",arm,"0"]),arm,0);
  assert.deepEqual(run.stable,result.arms.find(a=>a.arm===arm).rows,`native replay: ${arm}`);
}
assert.deepEqual({...analyze(result,timing),result_sha256:sha256(resultBytes),timing_sha256:sha256(timingBytes)},analysis);
// The timing schedule gives every method every process position twice.
for(const arm of ARMS) for(let position=0;position<6;position++)
  assert.equal(Array.from({length:12},(_,p)=>armOrder(p)[position]).filter(x=>x===arm).length,2);
for(const args of [["execute"],["benchmark","unknown","0"],["benchmark","task_guide","12"],
  ["benchmark","task_guide","-1"],["benchmark","task_guide","0x"],["benchmark","task_guide",""]])
  assert.equal(spawnSync(BINARY,args,{cwd:ROOT}).status,2);
// Reject changed selection records before replay and changed process ordering before analysis.
const changed=structuredClone(result); changed.families[0].nonce++;
assert.throws(()=>validateResults(changed,cohort));
const swapped=structuredClone(timing); [swapped.processes[0],swapped.processes[1]]=[swapped.processes[1],swapped.processes[0]];
assert.throws(()=>analyze(result,swapped));
const altered=structuredClone(timing); altered.processes[0].samples[0].cpu_ns=0;
assert.throws(()=>analyze(result,altered));
console.log(`Reasoner 5.5 fixed transfer passed: ${result.evidence.replayed_rows} rows, 128 fresh families, frozen 1863-byte model, 12 balanced timing passes`);
