import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, SMOKE_SEED, collectChild, verifyCohort, sourceBindings as parentBindings, sha, encode } from './lib/reasoner55_matched.mjs';
import { loadModel } from './lib/reasoner55_fixed_transfer.mjs';
import { publicTask, buildUniverse, featureGroups, featureDigest, rankGroups } from './lib/reasoner55_semantic_guide.mjs';
import { deriveR55TieSalt } from './lib/reasoner55_replay.mjs';
import { canonicalCandidateOrder } from './lib/reasoner5_harness.mjs';

const ARMS = ['semantic_frequency', 'task_guide', 'raw_lexical_task_guide', 'task_without_prior_feature'];
const MAPPED = [1, 3, 5, 7], PLANNERS = ['reference', 'eligible'];
const BINARY = resolve(ROOT, 'build/reasoner55_eligible');
const FIXTURE = 'benchmarks/reasoner55-eligible-scoring-v1';
const TIMERS = ['adapter_ns', 'enumerate_ns', 'group_ns', 'score_ns', 'sort_ns', 'receipt_ns', 'search_ns', 'wall_ns', 'cpu_ns'];
const WORK = ['feature_programs', 'prior_calls', 'rich_groups', 'scored_groups', 'heap_comparisons', 'batches', 'maximum_batch'];
const stable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !TIMERS.includes(key) && key !== 'phase'));
const shared = row => Object.fromEntries(Object.entries(stable(row)).filter(([key]) => !WORK.includes(key)));
const key = map => [...map.matrix, ...map.bias].reduce((sum, v, i) => sum + v * 5 ** i, 0);
const apply = (map, input) => map.bias.map((b, r) => (b + input.reduce((sum, v, c) => sum + map.matrix[r * 3 + c] * v, 0)) % 5);
const digestMap = map => sha(Buffer.concat([Buffer.from('reasoner55-affine\0'), Buffer.from([...map.matrix, ...map.bias])]));
const fields = [...Object.keys(parentBindings()), 'reasoner55_eligible.c', 'Makefile.reasoner55-eligible',
  'scripts/embed_reasoner55_eligible.mjs', 'scripts/check_reasoner55_eligible.mjs', `${FIXTURE}/PLAN.md`];
const bindings = () => Object.fromEntries(fields.map(path => [path, sha(readFileSync(resolve(ROOT, path)))]));
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--write-smoke'));
const output = process.env.REASONER_ELIGIBLE_RECEIPTS || mkdtempSync(resolve(tmpdir(), 'reasoner-eligible-'));
mkdirSync(output, { recursive: true });
const processes = [], started = Date.now(); let stage = 'heap';
const terminal = data => writeFileSync(resolve(output, 'TERMINAL.json'), encode(data));
try {
  const heap = spawnSync(BINARY, ['--heap-check'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 });
  writeFileSync(resolve(output, 'heap.json'), encode({ status: heap.status, stderr: heap.stderr }));
  assert.equal(heap.status, 0, heap.stderr);
  stage = 'cohort';
  const cohort = collectChild({ executable: BINARY, args: ['cohort'], output: resolve(output, 'cohort'), timeoutMs: 60000 });
  const families = verifyCohort(cohort, 1, SMOKE_SEED), model = loadModel();
  const bases = new Map(families.map(family => {
    const base = buildUniverse(publicTask(family));
    base.fallback = canonicalCandidateOrder(base.programs.map(p => ({ semantic: p.key, ast: p.ast, partial_expansions: 1 })));
    return [family.ordinal, base];
  }));
  const expectedEpisodes = [0,128,256,384].flatMap(start => [0,1,2,3].map(view => start + view));
  let replayed = 0;
  const selectedRows = {};
  function replay(row, arm) {
    const family = families.find(f => f.ordinal === Math.floor(row.episode / 4));
    const base = bases.get(family.ordinal), source = Math.floor(row.episode / 2) % 2, tie = row.episode % 2;
    const eligible = row.case === 'empty_eligible_set' ? [] : base.groups.filter(g => g.loss === 0);
    const features = featureGroups({ ...base, groups: eligible }, model.guides[source], MAPPED[arm]);
    const ranked = rankGroups(features, model.weights[source], MAPPED[arm], deriveR55TieSalt(family.familySeed, source, tie)).slice(0, row.budget);
    assert.equal(row.groups, base.groups.length);
    assert.equal(row.eligible_groups, eligible.length);
    assert.equal(row.eligible_programs, eligible.reduce((sum, g) => sum + g.members.length, 0));
    assert.equal(row.features_sha256, featureDigest(features));
    assert.deepEqual(row.proposal_keys, ranked.map(g => g.key));
    const order = Buffer.alloc(ranked.length * 4); ranked.forEach((g, i) => order.writeUInt32LE(g.key, i * 4));
    assert.equal(row.proposal_order_sha256, sha(order));
    const injection = base.programs.find(p => p.key !== key(family.target));
    assert.equal(row.injection_ast, injection.ast);
    const seen = new Set(); let checks = 0, partial = 4096 + base.groups.length, solved = false, hit = false;
    let firstCounterexample = 4294967295, accepted = 4294967295, proposalAttempts = 0, fallbackAttempts = 0, fallbackChecks = 0;
    function visit(ast) {
      if (checks >= row.cap) { hit = true; return true; }
      ++partial;
      const candidate = base.programs[ast];
      if (seen.has(candidate.key)) return false;
      seen.add(candidate.key); ++checks;
      for (let point = 0; point < 125; ++point) {
        const input = [Math.floor(point / 25), Math.floor(point / 5) % 5, point % 5];
        if (apply(candidate.semantic, input).some((v, lane) => v !== apply(family.target, input)[lane])) {
          if (checks === 1) firstCounterexample = point;
          return false;
        }
      }
      solved = true; accepted = ast; return true;
    }
    assert.equal(visit(injection.ast), false);
    for (const group of ranked) { ++proposalAttempts; if (visit(group.representative)) break; }
    const fallback = !solved && !hit;
    if (fallback) {
      const before = checks;
      for (const candidate of base.fallback) { ++fallbackAttempts; if (visit(candidate.ast)) break; }
      fallbackChecks = checks - before;
    }
    const expected = { verifier_checks: checks, partial_expansions: partial, exact: solved, certificate_valid: solved,
      primary_cost: solved ? checks : row.cap + 1, counterexample: firstCounterexample, accepted_ast: accepted,
      proposal_attempts: proposalAttempts, fallback_attempts: fallbackAttempts, fallback_checks: fallbackChecks,
      fallback_started: fallback, global_cap_hit: hit, fallback_exhausted: fallback && !solved && !hit,
      injected_invalid_rejected: true, accepted_semantic_sha256: solved ? digestMap(family.target) : '0'.repeat(64),
      observation_queries: 32, source_artifact_reads: arm === 0 ? 0 : arm === 3 ? 16 : 921 };
    for (const [name, value] of Object.entries(expected)) assert.deepEqual(row[name], value, `independent ${name}`);
    ++replayed;
  }
  for (const [arm, name] of ARMS.entries()) {
    selectedRows[name] = {};
    for (const planner of PLANNERS) {
      stage = `${name}-${planner}`;
      const rows = collectChild({ executable: BINARY, args: ['smoke', planner, name], output: resolve(output, stage), timeoutMs: 60000 });
      processes.push({ arm: name, planner, rows });
      const [meta] = rows, end = rows.at(-1), all = rows.slice(1, -1);
      assert.deepEqual([meta.kind, meta.scope, meta.arm, meta.planner, meta.seed], ['metadata', 'opened_four_family_engineering', name, planner, SMOKE_SEED]);
      assert.equal(end.kind, 'process'); assert.equal(end.failed, false); assert.equal(end.completed_episodes, 35); assert.equal(rows.length, 37);
      const normal = all.filter(r => r.case === 'normal'), special = all.filter(r => r.case !== 'normal');
      const warmup = normal.filter(r => r.phase === 'warmup'), measured = normal.filter(r => r.phase === 'measured');
      assert.deepEqual(warmup.map(r => r.episode), expectedEpisodes); assert.deepEqual(measured.map(r => r.episode), expectedEpisodes);
      assert.deepEqual(warmup.map(stable), measured.map(stable));
      assert.deepEqual(special.map(r => r.case), ['zero_budget', 'empty_eligible_set', 'verifier_cap']);
      for (const row of all) {
        assert.equal(row.kind, 'row'); assert.equal(row.failed, false); assert.equal(row.program_scans, 4096);
        for (const timer of TIMERS) assert.ok(Number.isSafeInteger(row[timer]) && row[timer] >= 0, timer);
        assert.ok(row.wall_ns >= TIMERS.slice(0, -2).reduce((sum, k) => sum + row[k], 0));
        assert.ok(row.maximum_batch <= 64 && row.selected <= 64);
        assert.equal(row.scored_groups, planner === 'reference' ? row.groups : row.eligible_groups);
        assert.equal(row.feature_programs, planner === 'reference' ? 4096 : row.eligible_programs);
        assert.equal(row.prior_calls, arm === 1 || arm === 2 ? row.feature_programs : 0);
        assert.equal(row.rich_groups, arm === 0 ? 0 : row.scored_groups);
      }
      assert.ok(end.process_wall_ns >= meta.preparation_ns + all.reduce((sum, r) => sum + r.wall_ns, 0));
      assert.ok(end.process_cpu_ns >= meta.preparation_cpu_ns + all.reduce((sum, r) => sum + r.cpu_ns, 0));
      assert.ok(end.peak_rss_bytes > 0);
      selectedRows[name][planner] = [...measured, ...special];
      if (planner === 'eligible') for (const row of selectedRows[name][planner]) replay(row, arm);
    }
    assert.deepEqual(selectedRows[name].reference.map(shared), selectedRows[name].eligible.map(shared), `${name}: both planners agree`);
  }
  stage = 'changed-evidence';
  for (const mutate of [
    row => { row.features_sha256 = '0'.repeat(64); },
    row => { row.proposal_keys[0] += 1; },
    row => { row.verifier_checks += 1; },
    row => { row.fallback_attempts += 1; },
  ]) {
    const row = structuredClone(selectedRows.task_guide.eligible[0]);
    mutate(row);
    assert.throws(() => replay(row, 1));
  }
  stage = 'failure-retention';
  const missing = mkdtempSync(resolve(tmpdir(), 'reasoner-eligible-missing-model-'));
  assert.throws(() => collectChild({ executable: BINARY, args: ['smoke', 'eligible', 'task_guide'],
    cwd: missing, output: resolve(output, 'missing-model'), timeoutMs: 60000 }));
  assert.equal(JSON.parse(readFileSync(resolve(output, 'missing-model.terminal.json'))).status, 1);
  const failure = readFileSync(resolve(output, 'missing-model.jsonl'), 'utf8').trim().split('\n').map(v => JSON.parse(v));
  assert.equal(failure.at(-1).failed, true); assert.equal(failure.at(-1).completed_episodes, 0);
  for (const args of [[], ['smoke'], ['smoke','other','task_guide'], ['smoke','eligible','unknown']])
    assert.equal(spawnSync(BINARY, args, { cwd: ROOT, stdio: 'ignore' }).status, 2);
  const report = { schema: 'zero.reasoner55_eligible_smoke.v1', scope: 'opened_four_family_engineering', seed: SMOKE_SEED,
    families: 4, arms: 4, planners: 2, native_episode_visits: 280, independent_measured_replays: replayed, heap_size_cases: 258, changed_evidence_rejections: 4,
    timing_evidence: false, fresh_family_evaluations: 0, model_sha256: model.artifact_sha256,
    source_bindings: bindings(), cohort_sha256: sha(encode(cohort)),
    stable_rows_sha256: sha(encode(Object.fromEntries(ARMS.map(name => [name, Object.fromEntries(PLANNERS.map(planner => [planner, selectedRows[name][planner].map(stable)]))])))),
    work: ARMS.map(name => ({ arm: name, ...Object.fromEntries(PLANNERS.map(planner => {
      const rows = selectedRows[name][planner].filter(r => r.case === 'normal');
      return [planner, Object.fromEntries(['feature_programs','prior_calls','scored_groups','selected','verifier_checks','fallback_checks'].map(k => [k, rows.reduce((sum,r) => sum + r[k],0)]))];
    })) })),
    fixtures: { zero_budget_fallbacks: 8, empty_set_fallbacks: 8, verifier_cap_stops: 8, missing_model_processes: 1 } };
  writeFileSync(resolve(output, 'SMOKE.json'), encode(report));
  const frozen = resolve(ROOT, FIXTURE, 'SMOKE.json');
  if (process.argv[2] === '--write-smoke') writeFileSync(frozen, encode(report));
  else assert.deepEqual(report, JSON.parse(readFileSync(frozen)), 'saved opened check and source bindings agree');
  terminal({ status: 'passed', completed_processes: processes.length, independent_replays: replayed, elapsed_ms: Date.now() - started });
  console.log(`Eligible scoring passed: 280 native visits, ${replayed} independent replays, 258 heap cases, fallback and cap receipts.`);
} catch (error) {
  terminal({ status: 'failed', stage, completed_processes: processes.length, error: String(error), elapsed_ms: Date.now() - started });
  throw error;
}
