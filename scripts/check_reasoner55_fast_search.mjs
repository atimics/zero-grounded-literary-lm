import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { ROOT, FIXTURE, BINARIES, CONDITIONS, MODEL_SHA, bytes, sha256, native, nativeJSON,
  readJSON, readReference, makeResult, runCondition, conditionOrder, analyze } from "./lib/reasoner55_fast_search.mjs";

const reference=readReference();
for (const binary of ["hash","sort","both"]) {
  assert.match(native(binary,["--fast-self-test"]),/119 SHA vectors and 448 sort cases/u);
  const vectors=nativeJSON(binary,["--hash-vectors"]);
  assert.equal(vectors.length,119);
  const buffer=Buffer.alloc(1048576);
  for (let i=0;i<buffer.length;i++) buffer[i]=(i*31+Math.floor(i/251))&255;
  for (const vector of vectors)
    assert.equal(vector.sha256,createHash("sha256").update(buffer.subarray(0,vector.length)).digest("hex"));
  assert.equal(nativeJSON(binary,["--training-cost"])[0].model_sha256,MODEL_SHA);
  assert.match(native(binary,["--self-test"]),/524288 new program maps and prefix features passed/u);
}
for (const condition of CONDITIONS) runCondition(condition,0,reference);
const result=readJSON(`${FIXTURE}/RESULTS.json`),timing=readJSON(`${FIXTURE}/TIMING.json`);
const stored=readJSON(`${FIXTURE}/ANALYSIS.json`);
assert.deepEqual(result,makeResult(reference));
assert.deepEqual({...analyze(result,timing,reference),result_sha256:sha256(bytes(result)),
  timing_sha256:sha256(readFileSync(resolve(ROOT,FIXTURE,"TIMING.json")))},stored);
for (const condition of CONDITIONS) for (let position=0;position<8;position++)
  assert.equal(Array.from({length:16},(_,p)=>conditionOrder(p)[position].id).filter(id=>id===condition.id).length,2);

const changed=structuredClone(timing); changed.processes[0].stable_sha256="0".repeat(64);
assert.throws(()=>analyze(result,changed,reference));
const swapped=structuredClone(timing); [swapped.processes[0],swapped.processes[1]]=[swapped.processes[1],swapped.processes[0]];
assert.throws(()=>analyze(result,swapped,reference));
const zero=structuredClone(timing); zero.processes[0].samples[0].cpu_ns=0;
assert.throws(()=>analyze(result,zero,reference));
const changedModel=structuredClone(result); changedModel.model_sha256="0".repeat(64);
assert.throws(()=>analyze(changedModel,timing,reference));
for (const binary of ["hash","sort","both"]) for (const args of [["unknown"],["benchmark","unknown","0"],["benchmark","task_guide","12"]])
  assert.equal(spawnSync(resolve(ROOT,BINARIES[binary]),args,{cwd:ROOT,stdio:"ignore"}).status,2);
const temporary=mkdtempSync(resolve(tmpdir(),"reasoner55-fast-model-"));
try {
  const model="benchmarks/reasoner55-semantic-guide-v1/MODEL.hex";
  mkdirSync(dirname(resolve(temporary,model)),{recursive:true});
  const content=Buffer.from(readFileSync(resolve(ROOT,model),"utf8").trim(),"hex");
  content[content.length-1]^=1;
  writeFileSync(resolve(temporary,model),`${content.toString("hex")}\n`);
  for (const binary of ["hash","sort","both"])
    assert.equal(spawnSync(resolve(ROOT,BINARIES[binary]),["benchmark","task_guide","0"],{cwd:temporary,stdio:"ignore"}).status,1);
  assert.equal(spawnSync(resolve(ROOT,BINARIES.both),["benchmark","target_only","0"],{cwd:temporary,stdio:"ignore"}).status,0);
} finally { rmSync(temporary,{recursive:true,force:true}); }
console.log("Reasoner 5.5 speed checks passed: 4096 fresh native rows, exact audit digests, 65536 recorded samples, hash/sort boundaries, fixed training, fallback and cap");
