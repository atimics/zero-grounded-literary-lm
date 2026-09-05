import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, FIXTURE as REFERENCE, MODEL_SHA, TIMERS, episodeOrder, splitProcess,
  sourceBindings as referenceBindings, sha256, median } from "./reasoner55_fixed_transfer.mjs";

export { ROOT, REFERENCE, MODEL_SHA, sha256, median };
export const FIXTURE = "benchmarks/reasoner55-fast-search-v1";
export const REFERENCE_COMMIT = "b81a1b3bdca3fba81de5621cbf3e3d9987be00dc";
export const BINARIES = {
  original: "build/reasoner55_fixed_transfer",
  hash: "build/reasoner55_fast_hash",
  sort: "build/reasoner55_fast_sort",
  both: "build/reasoner55_fast_both",
};
export const CONDITIONS = [
  { id: "original_task", arm: "task_guide", binary: "original" },
  { id: "hash_task", arm: "task_guide", binary: "hash" },
  { id: "sort_task", arm: "task_guide", binary: "sort" },
  { id: "fast_task", arm: "task_guide", binary: "both" },
  { id: "original_target", arm: "target_only", binary: "original" },
  { id: "fast_target", arm: "target_only", binary: "both" },
  { id: "original_jit", arm: "source_free_jit", binary: "original" },
  { id: "fast_jit", arm: "source_free_jit", binary: "both" },
];
export const bytes = object => `${JSON.stringify(object, null, 2)}\n`;
const read = path => readFileSync(resolve(ROOT, path));
export const readJSON = path => JSON.parse(read(path));
const mean = values => values.reduce((a,b) => a+b, 0) / values.length;
const rounded = value => Number(value.toPrecision(12));
export const rowDigest = rows => sha256(JSON.stringify(rows.map(row =>
  Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])))));
export const conditionOrder = pass => {
  const order = CONDITIONS.map((_,i) => CONDITIONS[(i+pass)%8]);
  return pass >= 8 ? order.reverse() : order;
};
export const native = (binary, args) => execFileSync(resolve(ROOT, BINARIES[binary]), args,
  { cwd: ROOT, encoding: "utf8", maxBuffer: 16*1024*1024 });
export const nativeJSON = (binary, args) => native(binary,args).trim().split("\n").map(JSON.parse);

export function readReference() {
  const reference = readJSON(`${REFERENCE}/RESULTS.json`);
  assert.equal(reference.schema, "zero.reasoner55_fixed_transfer.v1");
  assert.deepEqual(reference.source_bindings, referenceBindings());
  assert.equal(reference.model_sha256, MODEL_SHA);
  assert.equal(reference.evidence.replayed_rows, 3072);
  assert.equal(reference.evidence.families, 128);
  for (const arm of reference.arms) {
    assert.equal(arm.rows.length,512);
    assert.ok(arm.rows.every(row => row.exact && row.certificate_valid && row.injected_invalid_rejected));
  }
  return reference;
}
export function sourceBindings() {
  const files = ["reasoner55_fast_search.c", "reasoner55_fast_hash.h", "reasoner55_fast_sort.h",
    "scripts/embed_reasoner55_fast.mjs", "scripts/lib/reasoner55_fast_search.mjs",
    "scripts/run_reasoner55_fast_search.mjs", "scripts/check_reasoner55_fast_search.mjs",
    "Makefile.reasoner55", ".github/workflows/reasoner55.yml", `${FIXTURE}/SPEC.md`,
    `${REFERENCE}/RESULTS.json`, ...Object.keys(referenceBindings())];
  return Object.fromEntries([...new Set(files)].map(path => [path,sha256(read(path))]));
}
export function makeResult(reference=readReference()) {
  return { schema: "zero.reasoner55_fast_search.v1", reference_commit: REFERENCE_COMMIT,
    model_sha256: MODEL_SHA, source_bindings: sourceBindings(),
    conditions: CONDITIONS.map(condition => ({...condition, rows:512, passes:16,
      stable_sha256: rowDigest(reference.arms.find(arm => arm.arm === condition.arm).rows)})),
    evidence: { families:128, rows_per_condition:512, conditions:8, passes:16,
      exact_measured_rows:65536, model_bytes:1863 } };
}
export function runCondition(condition,pass,reference=readReference()) {
  const nativePass = pass%8;
  const process = splitProcess(nativeJSON(condition.binary,["benchmark",condition.arm,String(nativePass)]),
    condition.arm,nativePass);
  const expected = reference.arms.find(arm => arm.arm === condition.arm).rows;
  assert.deepEqual(process.stable,expected,`exact full result parity: ${condition.id}, pass ${pass}`);
  return {...process.timing, condition:condition.id, pass, native_pass:nativePass,
    stable_sha256:rowDigest(process.stable)};
}

function bootstrapDraws() {
  const mask=(1n<<64n)-1n, step=0x9e3779b97f4a7c15n;
  const mix=input => {
    let value=(input+step)&mask;
    value=((value^(value>>30n))*0xbf58476d1ce4e5b9n)&mask;
    value=((value^(value>>27n))*0x94d049bb133111ebn)&mask;
    return (value^(value>>31n))&mask;
  };
  let state=mix(0x626f6f742d763031n^mix(0n));
  // Bound 32 divides 2^64, so the rejection threshold is zero.
  return Array.from({length:5000},()=>Array.from({length:128},(_,i)=> {
    state=(state+step)&mask;
    return Math.floor(i/32)*32+Number(mix(state)%32n);
  }));
}
function interval(logs,draws) {
  const ratios=draws.map(indexes=>Math.exp(mean(indexes.map(i=>logs[i])))).sort((a,b)=>a-b);
  const at=q=>rounded(ratios[Math.ceil(q*ratios.length)-1]);
  return {ratio:rounded(Math.exp(mean(logs))),lower_95:at(.025),upper_one_sided_95:at(.95),upper_95:at(.975)};
}

export function analyze(result,timing,reference=readReference()) {
  assert.deepEqual(result,makeResult(reference));
  assert.equal(timing.schema,"zero.reasoner55_fast_search_timing.v1");
  assert.equal(timing.result_sha256,sha256(bytes(result)));
  assert.equal(timing.passes,16);
  assert.ok(Number.isFinite(Date.parse(timing.measured_at)));
  assert.ok(timing.host.cpu && timing.host.platform && timing.host.arch && timing.compiler && timing.build_flags);
  assert.deepEqual(Object.keys(timing.binaries),Object.keys(BINARIES));
  for (const binary of Object.values(timing.binaries)) {
    assert.match(binary.sha256,/^[a-f0-9]{64}$/u);
    assert.ok(binary.backend.hash && binary.backend.sort);
  }
  const expectedOrder=Array.from({length:16},(_,p)=>conditionOrder(p).map(c=>`${p}:${c.id}`)).flat();
  assert.deepEqual(timing.processes.map(p=>`${p.pass}:${p.condition}`),expectedOrder);
  const times=new Map();
  for (const process of timing.processes) {
    const condition=result.conditions.find(c=>c.id===process.condition);
    assert.equal(process.kind,"metadata");
    assert.equal(process.arm,condition.arm);
    assert.equal(process.native_pass,process.pass%8);
    assert.equal(process.stable_sha256,condition.stable_sha256);
    assert.equal(process.model_bytes,condition.arm==="task_guide"?1863:0);
    for (const name of ["corpus_ns","corpus_cpu_ns","peak_rss_bytes"])
      assert.ok(Number.isSafeInteger(process[name]) && process[name]>0,name);
    for (const name of ["model_load_ns","model_load_cpu_ns"])
      assert.ok(Number.isSafeInteger(process[name]) && (condition.arm==="task_guide"?process[name]>0:process[name]===0),name);
    assert.deepEqual(process.samples.map(s=>s.episode),episodeOrder(process.native_pass));
    for (const sample of process.samples) {
      for (const timer of TIMERS) assert.ok(Number.isSafeInteger(sample[timer]) && sample[timer]>=0,timer);
      assert.ok(sample.cpu_ns>0 && sample.wall_ns>0);
      assert.ok(sample.wall_ns>=TIMERS.slice(0,-2).reduce((sum,t)=>sum+sample[t],0));
      const id=`${process.condition}:${sample.episode}`;
      if (!times.has(id)) times.set(id,[]);
      times.get(id).push(sample);
    }
  }
  const medians=new Map();
  for (const [id,samples] of times) {
    assert.equal(samples.length,16);
    medians.set(id,Object.fromEntries(TIMERS.map(t=>[t,median(samples.map(s=>s[t]))])));
  }
  const conditions=CONDITIONS.map(condition=> {
    const runs=timing.processes.filter(p=>p.condition===condition.id);
    const rows=reference.arms.find(a=>a.arm===condition.arm).rows;
    return {...condition,
      totals:{...Object.fromEntries(TIMERS.map(timer=>[timer,rows.reduce((sum,row)=>
        sum+medians.get(`${condition.id}:${row.episode}`)[timer],0)])),
        verifier_checks:rows.reduce((sum,row)=>sum+row.verifier_checks,0)},
      preparation:Object.fromEntries(["corpus_ns","corpus_cpu_ns","model_load_ns","model_load_cpu_ns"]
        .map(name=>[name,median(runs.map(p=>p[name]))])),
      peak_rss_bytes:{min:Math.min(...runs.map(p=>p.peak_rss_bytes)),max:Math.max(...runs.map(p=>p.peak_rss_bytes))},
      per_pass:runs.map(p=>({pass:p.pass,cpu_ns:p.samples.reduce((s,r)=>s+r.cpu_ns,0),
        wall_ns:p.samples.reduce((s,r)=>s+r.wall_ns,0)}))};
  });
  const pairs=[...CONDITIONS.map(c=>[c.id,"original_task"]),
    ...["original_target","original_jit","fast_target","fast_jit"].map(id=>["fast_task",id])];
  const draws=bootstrapDraws();
  const comparisons=pairs.map(([condition,baseline])=> {
    const arm=CONDITIONS.find(c=>c.id===condition).arm,baseArm=CONDITIONS.find(c=>c.id===baseline).arm;
    const rows=reference.arms.find(a=>a.arm===arm).rows,baseRows=reference.arms.find(a=>a.arm===baseArm).rows;
    const episodeLogs={cpu:[],wall:[],checks:[]},familyLogs={cpu:[],wall:[],checks:[]};
    for (let ep=0;ep<512;ep++) {
      const actual=medians.get(`${condition}:${ep}`),base=medians.get(`${baseline}:${ep}`);
      episodeLogs.cpu.push(Math.log(actual.cpu_ns/base.cpu_ns));
      episodeLogs.wall.push(Math.log(actual.wall_ns/base.wall_ns));
      episodeLogs.checks.push(Math.log((rows[ep].verifier_checks+1)/(baseRows[ep].verifier_checks+1)));
    }
    for (const metric of Object.keys(familyLogs))
      for (let family=0;family<128;family++) familyLogs[metric].push(mean(episodeLogs[metric].slice(family*4,family*4+4)));
    const summary=indexes=>Object.fromEntries(Object.entries(familyLogs).map(([metric,logs])=>
      [metric,rounded(Math.exp(mean(indexes.map(i=>logs[i]))))]));
    const actual=conditions.find(c=>c.id===condition),base=conditions.find(c=>c.id===baseline);
    return {condition,reference:baseline,
      paired:Object.fromEntries(Object.entries(familyLogs).map(([metric,logs])=>[metric,interval(logs,draws)])),
      families:Array.from({length:128},(_,ordinal)=>({ordinal,cell:Math.floor(ordinal/32),...summary([ordinal])})),
      cells:Array.from({length:4},(_,cell)=>({cell,...summary(Array.from({length:32},(_,i)=>cell*32+i))})),
      source_views:[0,1].map(source=>({source,...Object.fromEntries(Object.entries(episodeLogs).map(([metric,logs])=>
        [metric,rounded(Math.exp(mean(logs.filter((_,ep)=>Math.floor(ep/2)%2===source))))]))})),
      per_pass:actual.per_pass.map((p,i)=>({pass:p.pass,cpu:rounded(p.cpu_ns/base.per_pass[i].cpu_ns),
        wall:rounded(p.wall_ns/base.per_pass[i].wall_ns)}))};
  });
  const primary=comparisons.find(c=>c.condition==="fast_task"&&c.reference==="original_task");
  return {schema:"zero.reasoner55_fast_search_analysis.v1",bootstrap_draws:5000,
    primary_reference:"original_task",timing_summary:"Sum of per-episode medians; pass totals are separate",
    engineering_check:["cpu","wall"].every(metric=>primary.paired[metric].upper_one_sided_95<1)?"met":"further_research",
    conditions,comparisons};
}
