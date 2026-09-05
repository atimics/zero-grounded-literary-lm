import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateR55FamilyFromSeed, deriveR55TieSalt, parseR55Artifact,
  replayR55Search, decodeR55Replay } from "./reasoner55_replay.mjs";
import { ROOT, ORIGINAL, DIAGNOSTICS, sha256, publicTask, replayRow,
  trainModel } from "./reasoner55_semantic_guide.mjs";

export { ROOT, sha256, trainModel };
export const FIXTURE = "benchmarks/reasoner55-fixed-transfer-v1";
export const BINARY = resolve(ROOT, "build/reasoner55_fixed_transfer");
export const MODEL = "benchmarks/reasoner55-semantic-guide-v1/MODEL.hex";
export const MODEL_SHA = "db0afc1e460df5192917fac1f8129a2ec1e753ddb67939a975076fae5579bb7a";
export const ARMS = ["target_only", "source_free_jit", "semantic_frequency",
  "task_guide", "raw_lexical_task_guide", "task_without_prior_feature"];
export const TIMERS = ["adapter_ns", "jit_ns", "enumerate_ns", "group_ns",
  "score_ns", "sort_ns", "receipt_ns", "search_ns", "wall_ns", "cpu_ns"];
const MASK = (1n << 64n) - 1n, STEP = 0x9e3779b97f4a7c15n;
const readJSON = path => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
const key = map => [...map.matrix, ...map.bias].reduce((sum, v, i) => sum + v * 5 ** i, 0);
const astKey = roles => roles.reduce((sum, v) => sum * 8 + v, 0);
const operationKey = family => family.primitiveByRole.map(key).join(":");
const identity = () => ({ matrix: [1,0,0,0,1,0,0,0,1], bias: [0,0,0] });
const mean = values => values.reduce((a,b) => a+b, 0) / values.length;
export const median = values => {
  const v = [...values].sort((a,b) => a-b), n = v.length;
  assert.ok(n > 0); return n % 2 ? v[(n-1)/2] : (v[n/2-1]+v[n/2])/2;
};
const rounded = value => value === null ? null : Number(value.toPrecision(12));
function mix(value) {
  value = (value + STEP) & MASK;
  value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return (value ^ (value >> 31n)) & MASK;
}
function rng(seed, stream) {
  let state = mix(seed ^ mix(stream));
  return { index(bound) {
    const b = BigInt(bound), threshold = ((1n << 64n) - b) % b;
    let value;
    do { state = (state + STEP) & MASK; value = mix(state); } while (value < threshold);
    return Number(value % b);
  }};
}
function shuffled(length, random) {
  const order = Array.from({ length }, (_,i) => i);
  for (let i = length - 1; i > 0; --i) {
    const j = random.index(i+1); [order[i],order[j]] = [order[j],order[i]];
  }
  return order;
}
export function episodeOrder(pass) {
  return shuffled(512, rng(0x74696d652d763031n, BigInt(pass)));
}
export function armOrder(pass) {
  const order = ARMS.map((_,i) => ARMS[(i+pass)%6]);
  return pass >= 6 ? order.reverse() : order;
}
function compose(a,b) {
  const matrix = [], bias = [];
  for (let r=0;r<3;r++) {
    for (let c=0;c<3;c++) {
      let v=0; for(let k=0;k<3;k++) v+=a.matrix[r*3+k]*b.matrix[k*3+c];
      matrix.push(v%5);
    }
    let v=a.bias[r]; for(let k=0;k<3;k++) v+=a.matrix[r*3+k]*b.bias[k];
    bias.push(v%5);
  }
  return { matrix, bias };
}
function apply(map, input) {
  return map.bias.map((b,r) => (b + input.reduce((v,x,c) => v+map.matrix[r*3+c]*x,0))%5);
}
function roleMaps(family, length) {
  let maps=[identity()];
  for(let depth=0;depth<length;depth++)
    maps=maps.flatMap(map => family.primitiveByRole.map(p => compose(p,map)));
  return maps;
}
function dense(seed, role) {
  const random=rng(seed,0x64656e73652d7631n+BigInt(role));
  for(let attempt=0;attempt<1024;attempt++) {
    const m=Array.from({length:9},()=>1+random.index(4));
    const det=m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
    if(((det%5)+5)%5===0) continue;
    return {matrix:m,bias:role===7?Array.from({length:3},()=>1+random.index(4)):[0,0,0]};
  }
  throw Error("dense operation generation exhausted");
}
function candidate(ordinal,nonce) {
  const seed=mix(0x5533667265736831n^(BigInt(ordinal)<<16n)^BigInt(nonce));
  const f=generateR55FamilyFromSeed({familySeed:seed,generator:0,ordinal});
  if(ordinal>=64) for(const role of [6,7]) f.primitiveByRole[role]=dense(seed,role);
  const binding=shuffled(8,rng(seed,0x636f6d702d763031n));
  f.targetRoles=Array.from({length:4},(_,i)=>binding[Math.floor(ordinal/32)%2?i%2:i]);
  f.targetSurface=f.targetRoles.map(role=>f.roleToSurface[role]);
  f.target=f.targetRoles.reduce((m,r)=>compose(f.primitiveByRole[r],m),identity());
  f.exampleOutput=apply(f.target,f.exampleInput);
  return f;
}
function familyRecord(f,nonce,rejections) {
  const target=key(f.target);
  let minimum=0;
  while(minimum<4 && !roleMaps(f,minimum).some(m=>key(m)===target)) minimum++;
  return {ordinal:f.ordinal,cell:Math.floor(f.ordinal/32),nonce,
    family_seed:f.familySeed.toString(16).padStart(16,"0"),minimum_length:minimum,
    rejections:[...rejections],primitive_by_role:f.primitiveByRole,
    surface_to_role:f.surfaceToRole,surface_ids:f.surfaceIds,target_roles:f.targetRoles,
    target:f.target,example_input:f.exampleInput,example_output:f.exampleOutput};
}
export function generateCohort() {
  const seeds=readJSON(`${DIAGNOSTICS}/DIAGNOSTICS.json`).arms[0].sources;
  const sources=seeds.map(s=>generateR55FamilyFromSeed({familySeed:s.family_seed,generator:s.generator,ordinal:s.ordinal}));
  const trace=readFileSync(resolve(ROOT,ORIGINAL,"DEVELOPMENT-TRACE.jsonl"),"utf8").trim().split("\n").map(JSON.parse);
  // Trace fields use an embedded replay recipe. Select unique targets explicitly.
  const originalTargets=new Map();
  for(const row of trace.filter(r=>r.arm==="target_only")) {
    const f=decodeR55Replay(row); originalTargets.set(`${f.generator}:${f.ordinal}`,f);
  }
  assert.equal(originalTargets.size,8);
  const originals=[...sources,...originalTargets.values()];
  const seenAst=new Set(originals.map(f=>astKey(f.targetRoles)));
  for(const f of sources) roleMaps(f,4).forEach((map,ast)=> {if(key(map)===key(f.target)) seenAst.add(ast);});
  const seenBehavior=new Set(originals.map(f=>key(f.target)));
  const seenOperations=new Set(originals.map(operationKey));
  const families=[],records=[];
  for(let ordinal=0;ordinal<128;ordinal++) {
    const rejected=[0,0,0,0]; let found=false;
    for(let nonce=0;nonce<65536;nonce++) {
      const f=candidate(ordinal,nonce);
      let reason=-1;
      if(!f.targetRoles.some(r=>r>=6)) reason=0;
      else if(seenAst.has(astKey(f.targetRoles))) reason=1;
      else if(seenBehavior.has(key(f.target))) reason=2;
      else if(seenOperations.has(operationKey(f))) reason=3;
      if(reason>=0) { rejected[reason]++; continue; }
      publicTask(f); // Prove all affine reconstructions and role assignments.
      records.push(familyRecord(f,nonce,rejected)); families.push(f);
      seenBehavior.add(key(f.target)); seenOperations.add(operationKey(f)); found=true; break;
    }
    assert.ok(found,`family ${ordinal} generation exhausted`);
  }
  return {families,records,source_sequence_exclusions:seenAst.size};
}
export function loadModel() {
  const bytes=Buffer.from(readFileSync(resolve(ROOT,MODEL),"utf8").trim(),"hex");
  assert.equal(bytes.length,1863); assert.equal(sha256(bytes),MODEL_SHA);
  assert.equal(bytes.subarray(0,8).toString(),"R55T0001");
  const guides=parseR55Artifact(bytes.subarray(8,1831));
  const weights=Array.from({length:2},(_,g)=>Array.from({length:4},(_,f)=>bytes.readInt32LE(1831+g*16+f*4)));
  return {guides,weights,artifact_sha256:MODEL_SHA,artifact_bytes:1863};
}
export function native(args) {
  return execFileSync(BINARY,args,{cwd:ROOT,encoding:"utf8",maxBuffer:16*1024*1024})
    .trim().split("\n").map(JSON.parse);
}
export function splitProcess(output,arm,pass) {
  assert.equal(output.length,514);
  const metadata=output[0], process=output.at(-1), rows=output.slice(1,-1);
  assert.equal(metadata.kind,"metadata"); assert.equal(metadata.arm,arm); assert.equal(metadata.pass,pass);
  assert.equal(metadata.model_bytes,ARMS.indexOf(arm)>=3?1863:0);
  for(const name of ["corpus_ns","corpus_cpu_ns","model_load_ns","model_load_cpu_ns"])
    assert.ok(Number.isSafeInteger(metadata[name]) && metadata[name]>=0);
  if(ARMS.indexOf(arm)<3) {assert.equal(metadata.model_load_ns,0);assert.equal(metadata.model_load_cpu_ns,0);}
  else assert.ok(metadata.model_load_ns>0 && metadata.model_load_cpu_ns>0);
  assert.equal(process.kind,"process"); assert.ok(process.peak_rss_bytes>0);
  assert.deepEqual(rows.map(r=>r.episode),episodeOrder(pass));
  const stable=rows.map(row=> {
    assert.equal(row.kind,"row");
    for(const timer of TIMERS) assert.ok(Number.isSafeInteger(row[timer]) && row[timer]>=0, timer);
    assert.ok(row.wall_ns>0 && row.cpu_ns>0);
    assert.ok(row.wall_ns>=TIMERS.slice(0,-2).reduce((sum,t)=>sum+row[t],0));
    return Object.fromEntries(Object.entries(row).filter(([k])=>k!=="kind"&&!TIMERS.includes(k)));
  }).sort((a,b)=>a.episode-b.episode);
  return {stable,timing:{...metadata,peak_rss_bytes:process.peak_rss_bytes,
    samples:rows.map(row=>({episode:row.episode,...Object.fromEntries(TIMERS.map(t=>[t,row[t]]))}))}};
}
export function sourceBindings() {
  const files=["reasoner55_fixed_transfer.c","scripts/embed_reasoner55_guide.mjs",
    "scripts/lib/reasoner55_fixed_transfer.mjs","scripts/run_reasoner55_fixed_transfer.mjs",
    "reasoner55_semantic_guide.c","reasoner55_diagnostics.c","reasoner55.c","reasoner55.h",
    "scripts/lib/reasoner55_semantic_guide.mjs","scripts/lib/reasoner55_replay.mjs",
    "scripts/lib/reasoner5_harness.mjs",`${FIXTURE}/SPEC.md`,MODEL,
    `${DIAGNOSTICS}/DIAGNOSTICS.json`,`${ORIGINAL}/DEVELOPMENT-TRACE.jsonl`];
  return Object.fromEntries(files.map(f=>[f,sha256(readFileSync(resolve(ROOT,f)))]));
}
export function validateResults(result,cohort=generateCohort(),progress=()=>{}) {
  assert.equal(result.schema,"zero.reasoner55_fixed_transfer.v1");
  assert.deepEqual(result.source_bindings,sourceBindings());
  assert.deepEqual(result.families,cohort.records,"independent complete family selection");
  const model=loadModel(); assert.equal(result.model_sha256,MODEL_SHA);
  assert.deepEqual(result.arms.map(a=>a.arm),ARMS);
  const references=new Map();
  for(const original of cohort.families)
    for(let source=0;source<2;source++) for(let tie=0;tie<2;tie++) {
      const family={...original,sourceGenerator:source,tie,tieSalt:deriveR55TieSalt(original.familySeed,source,tie)};
      const digest=sha256(Buffer.concat([Buffer.from("reasoner55-affine\0"),Buffer.from([...family.target.matrix,...family.target.bias])]));
      references.set(`0:${family.ordinal}:${source}:${tie}`,{family,row:{accepted_semantic_sha256:digest}});
    }
  let replayed=0;
  for(const arm of result.arms)
    assert.deepEqual(arm.rows.map(r=>r.episode),Array.from({length:512},(_,i)=>i));
  for(let ordinal=0;ordinal<128;ordinal++) {
    // Candidate caches live for one target while all six methods are checked.
    const cache=new Map(),context={references,bases:new Map()};
    for(const [a,arm] of result.arms.entries()) for(const original of arm.rows.slice(ordinal*4,ordinal*4+4)) {
      const source=Math.floor(original.episode/2)%2,tie=original.episode%2;
      const reference=references.get(`0:${ordinal}:${source}:${tie}`),family=reference.family;
      const row={...original,target_generator:0,ordinal,source_generator:source,tie,
        family_seed:family.familySeed.toString(16).padStart(16,"0")};
      assert.equal(row.accepted_semantic_sha256,reference.row.accepted_semantic_sha256);
      if(a<2) {
        assert.equal(row.features_sha256,"0".repeat(64)); assert.equal(row.groups,0);
        assert.equal(row.observation_queries,a===1?32:0); assert.equal(row.source_artifact_reads,0);
        assert.equal(row.certificate_valid,true);
        replayR55Search({...row,arm:arm.arm,family_id:`fresh:${ordinal}`,episode_id:String(row.episode),
          censoring_reason:null},family,model.guides[source],cache);
      } else replayRow(row,[1,3,5,7][a-2],model,context);
      assert.equal(row.exact,true); assert.equal(row.injected_invalid_rejected,true); replayed++;
    }
    if((ordinal+1)%16===0) progress(ordinal+1);
  }
  return {families:128,episodes_per_arm:512,replayed_rows:replayed,exact_answers:replayed,
    source_sequence_exclusions:cohort.source_sequence_exclusions,model_bytes:1863};
}

function interval(logs,draws) {
  const ratios=draws.map(indexes=>Math.exp(mean(indexes.map(i=>logs[i])))).sort((a,b)=>a-b);
  const percentile=q=>ratios[Math.ceil(q*ratios.length)-1];
  return {ratio:rounded(Math.exp(mean(logs))),lower_95:rounded(percentile(.025)),
    upper_one_sided_95:rounded(percentile(.95)),upper_95:rounded(percentile(.975))};
}
function draws() {
  const random=rng(0x626f6f742d763031n,0n);
  return Array.from({length:5000},()=>Array.from({length:128},(_,i)=>Math.floor(i/32)*32+random.index(32)));
}
export function analyze(result,timing) {
  assert.equal(timing.passes,12); assert.equal(timing.processes.length,72); assert.equal(timing.training.length,3);
  const timings=new Map();
  const expectedOrder=Array.from({length:12},(_,p)=>armOrder(p).map(arm=>`${p}:${arm}`)).flat();
  assert.deepEqual(timing.processes.map(p=>`${p.pass}:${p.arm}`),expectedOrder);
  for(const process of timing.processes) {
    assert.deepEqual(process.samples.map(s=>s.episode),episodeOrder(process.pass));
    assert.equal(process.model_bytes,ARMS.indexOf(process.arm)>=3?1863:0);
    assert.ok(process.peak_rss_bytes>0 && process.corpus_ns>0 && process.corpus_cpu_ns>0);
    for(const name of ["model_load_ns","model_load_cpu_ns"])
      assert.ok(Number.isSafeInteger(process[name]) && process[name]>=0);
    if(ARMS.indexOf(process.arm)<3) assert.equal(process.model_load_ns+process.model_load_cpu_ns,0);
    for(const sample of process.samples) {
      for(const timer of TIMERS) assert.ok(Number.isSafeInteger(sample[timer]) && sample[timer]>=0);
      assert.ok(sample.wall_ns>0 && sample.cpu_ns>0);
      assert.ok(sample.wall_ns>=TIMERS.slice(0,-2).reduce((sum,t)=>sum+sample[t],0));
      const id=`${process.arm}:${sample.episode}`;
      if(!timings.has(id)) timings.set(id,[]); timings.get(id).push(sample);
    }
  }
  const medians=new Map();
  for(const [id,samples] of timings) {
    assert.equal(samples.length,12);
    medians.set(id,Object.fromEntries(TIMERS.map(t=>[t,median(samples.map(s=>s[t]))])));
  }
  for(const t of timing.training) {
    assert.equal(t.model_sha256,MODEL_SHA);
    for(const name of ["training_cpu_ns","training_wall_ns","corpus_ns","corpus_cpu_ns"])
      assert.ok(Number.isSafeInteger(t[name]) && t[name]>0);
  }
  const training={cpu_ns:median(timing.training.map(t=>t.training_cpu_ns)),
    wall_ns:median(timing.training.map(t=>t.training_wall_ns))};
  const bootstrap=draws(), baseline=result.arms[1];
  const arms=result.arms.map(arm=> {
    const family_logs={checks:[],cpu:[],wall:[]},families=[];
    for(let ordinal=0;ordinal<128;ordinal++) {
      const logs={checks:[],cpu:[],wall:[]};
      for(let view=0;view<4;view++) {
        const episode=ordinal*4+view,m=medians.get(`${arm.arm}:${episode}`),b=medians.get(`source_free_jit:${episode}`);
        logs.checks.push(Math.log((arm.rows[episode].verifier_checks+1)/(baseline.rows[episode].verifier_checks+1)));
        logs.cpu.push(Math.log(m.cpu_ns/b.cpu_ns)); logs.wall.push(Math.log(m.wall_ns/b.wall_ns));
      }
      const ratios={};
      for(const metric of ["checks","cpu","wall"]) {
        family_logs[metric].push(mean(logs[metric])); ratios[metric]=rounded(Math.exp(mean(logs[metric])));
      }
      families.push({ordinal,cell:Math.floor(ordinal/32),minimum_length:result.families[ordinal].minimum_length,...ratios});
    }
    const totals=Object.fromEntries(TIMERS.map(t=>[t,arm.rows.reduce((sum,r)=>sum+medians.get(`${arm.arm}:${r.episode}`)[t],0)]));
    totals.verifier_checks=arm.rows.reduce((sum,r)=>sum+r.verifier_checks,0);
    const perPass=Array.from({length:12},(_,pass)=> {
      const process=timing.processes.find(p=>p.arm===arm.arm&&p.pass===pass);
      return {pass,cpu_ns:process.samples.reduce((s,r)=>s+r.cpu_ns,0),wall_ns:process.samples.reduce((s,r)=>s+r.wall_ns,0)};
    });
    const cost={};
    for(const metric of ["cpu","wall"]) {
      const load=median(timing.processes.filter(p=>p.arm===arm.arm).map(p=>p[metric==="cpu"?"model_load_cpu_ns":"model_load_ns"]));
      const reference=baseline.rows.reduce((sum,r)=>sum+medians.get(`source_free_jit:${r.episode}`)[`${metric}_ns`],0);
      const saving=(reference-totals[`${metric}_ns`])/512, trained=ARMS.indexOf(arm.arm)>=3;
      cost[metric]={training_ns:trained?training[`${metric}_ns`]:0,model_load_ns:load,
        saving_per_episode_ns:rounded(saving),training_and_load_break_even_episodes:
          trained && saving>0 ? Math.ceil((training[`${metric}_ns`]+load)/saving) : trained ? null : 0};
    }
    const viewSummary=indexes=>Object.fromEntries(["checks","cpu","wall"].map(metric=>[metric,rounded(Math.exp(mean(indexes.map(i=>family_logs[metric][i]))))]));
    const sourceViews=[0,1].map(source=> {
      const logs={checks:[],cpu:[],wall:[]};
      for(let task=0;task<128;task++) for(let tie=0;tie<2;tie++) {
        const ep=task*4+source*2+tie,m=medians.get(`${arm.arm}:${ep}`),b=medians.get(`source_free_jit:${ep}`);
        logs.checks.push(Math.log((arm.rows[ep].verifier_checks+1)/(baseline.rows[ep].verifier_checks+1)));
        logs.cpu.push(Math.log(m.cpu_ns/b.cpu_ns)); logs.wall.push(Math.log(m.wall_ns/b.wall_ns));
      }
      return {source,...Object.fromEntries(Object.entries(logs).map(([k,v])=>[k,rounded(Math.exp(mean(v)))]))};
    });
    return {arm:arm.arm,model_bytes:ARMS.indexOf(arm.arm)>=3?1863:0,totals,
      paired:Object.fromEntries(Object.entries(family_logs).map(([k,v])=>[k,interval(v,bootstrap)])),
      cells:Array.from({length:4},(_,cell)=>({cell,...viewSummary(Array.from({length:32},(_,i)=>cell*32+i))})),
      source_views:sourceViews,families,cost,per_pass:perPass,
      peak_rss_bytes:{min:Math.min(...timing.processes.filter(p=>p.arm===arm.arm).map(p=>p.peak_rss_bytes)),
        max:Math.max(...timing.processes.filter(p=>p.arm===arm.arm).map(p=>p.peak_rss_bytes))}};
  });
  const task=arms[3];
  return {reference:"source_free_jit",bootstrap_draws:5000,
    timing_summary:"Sum of per-episode medians; pass totals are reported separately",
    fixed_cohort_cost_rule:result.arms.every(a=>a.rows.every(r=>r.exact && r.certificate_valid)) &&
      Object.values(task.paired).every(v=>v.upper_one_sided_95<1)?"met":"further_research",
    training,arms};
}
