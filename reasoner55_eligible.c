/* Opened-fixture engineering check. Historical runners remain source-bound. */
#include "build/reasoner55_eligible_matched.h"

enum { R55E_BATCH = 64, R55E_ARMS = 4 };
static const uint32_t r55e_arms[R55E_ARMS] = {1, 3, 5, 7};
static const char *r55e_names[R55E_ARMS] = {"semantic_frequency", "task_guide",
    "raw_lexical_task_guide", "task_without_prior_feature"};
typedef struct {
    uint32_t eligible_programs, eligible_groups, program_scans, feature_programs;
    uint32_t prior_calls, rich_groups, scored_groups, comparisons, batches;
    uint32_t maximum_batch, selected, injection_ast, accepted_ast;
    uint32_t proposal_attempts, fallback_attempts, fallback_checks;
    uint8_t feature_digest[32];
} r55e_counts;

typedef struct { r55sg_group values[R55E_BATCH]; uint32_t count, limit; } r55e_heap;

static int r55e_compare(const r55sg_group *a, const r55sg_group *b, r55e_counts *counts)
{
    ++counts->comparisons;
    return r55sg_group_compare(a, b);
}

static void r55e_keep(r55e_heap *heap, const r55sg_group *value, r55e_counts *counts)
{
    if (!heap->limit) return;
    if (heap->count < heap->limit) {
        uint32_t index = heap->count++;
        heap->values[index] = *value;
        while (index) {
            uint32_t parent = (index - 1) / 2;
            if (r55e_compare(&heap->values[index], &heap->values[parent], counts) <= 0) break;
            r55sg_group temp = heap->values[index]; heap->values[index] = heap->values[parent];
            heap->values[parent] = temp; index = parent;
        }
    } else if (r55e_compare(value, &heap->values[0], counts) < 0) {
        heap->values[0] = *value;
        uint32_t index = 0;
        for (;;) {
            uint32_t child = index * 2 + 1;
            if (child >= heap->count) break;
            if (child + 1 < heap->count && r55e_compare(&heap->values[child + 1], &heap->values[child], counts) > 0) ++child;
            if (r55e_compare(&heap->values[index], &heap->values[child], counts) >= 0) break;
            r55sg_group temp = heap->values[index]; heap->values[index] = heap->values[child];
            heap->values[child] = temp; index = child;
        }
    }
}

static void r55e_features(r55sg_universe *u, const r55_guide *guide, int rich,
    int reference, r55e_counts *counts)
{
    for (uint32_t index = 0; index < R55_CANDIDATES; ++index) {
        const r55sg_program *p = &u->programs[index];
        r55sg_group *g = &u->groups[p->group];
        ++counts->program_scans;
        counts->eligible_programs += !g->evidence_loss;
        if (!reference && g->evidence_loss) continue;
        ++counts->feature_programs;
        if (guide) { g->source_mass += r55_guide_score(guide, p->candidate.role, 0); ++counts->prior_calls; }
        if (rich) {
            uint32_t seen = 0, distinct = 0;
            for (uint32_t pos = 0; pos < R55_PROGRAM_LEN; ++pos) seen |= 1u << p->candidate.role[pos];
            for (uint32_t role = 0; role < R55_ROLES; ++role) distinct += (seen >> role) & 1u;
            g->distinct += distinct == R55_PROGRAM_LEN;
            g->prefix_matches += p->prefix_matches;
        }
    }
    for (uint32_t index = 0; index < u->count; ++index) {
        r55sg_group *g = &u->groups[index];
        counts->eligible_groups += !g->evidence_loss;
        if (!rich || (!reference && g->evidence_loss)) continue;
        ++counts->rich_groups;
        g->features[0] = (int32_t)llround(R55SG_SCALE * log(g->count) / log(R55_CANDIDATES));
        g->features[1] = (int32_t)llround((double)R55SG_SCALE * g->distinct / g->count);
        g->features[2] = (int32_t)llround(R55SG_SCALE * log1p((double)g->source_mass / g->count) / (7.0 * log(65.0)));
        g->features[3] = (int32_t)llround((double)R55SG_SCALE * g->prefix_matches / (9.0 * g->count));
    }
}

/* This planner receives public candidate evidence, guide weights and a tie salt. */
static int r55e_plan(r55sg_universe *u, const r55_guide *guide, const int32_t weights[4],
    uint32_t arm, uint64_t salt, uint32_t budget, int reference,
    r55e_heap *selected, r55e_counts *counts, r55sg_timing *timing)
{
    if (budget > R55E_BATCH) return 1;
    memset(selected, 0, sizeof(*selected)); selected->limit = budget;
    int rich = arm != 1;
    uint64_t phase = r55d_now();
    r55e_features(u, guide, rich, reference, counts);
    for (uint32_t begin = 0; begin < u->count; begin += R55E_BATCH) {
        uint32_t used = 0;
        for (uint32_t index = begin; index < begin + R55E_BATCH && index < u->count; ++index) {
            r55sg_group *g = &u->groups[index];
            if (!reference && g->evidence_loss) continue;
            ++used; ++counts->scored_groups;
            g->tie = r55_mix64(salt ^ ((uint64_t)g->key * UINT64_C(0x9e3779b97f4a7c15)));
            if (arm == 1) g->score = g->count;
            else for (uint32_t f = 0; f < R55SG_FEATURES; ++f) g->score += (int64_t)weights[f] * g->features[f];
        }
        if (used) ++counts->batches;
        if (used > counts->maximum_batch) counts->maximum_batch = used;
    }
    timing->score = r55d_now() - phase;
    phase = r55d_now();
    r55_sha256 hash; r55_sha256_init(&hash);
    for (uint32_t index = 0; index < u->count; ++index) {
        const r55sg_group *g = &u->groups[index];
        if (g->evidence_loss) continue;
        uint8_t bytes[32]; r55_put_u32(bytes, 0, g->key); r55_put_u32(bytes, 4, g->count);
        for (uint32_t f = 0; f < 4; ++f) r55_put_u32(bytes, 8 + f * 4, (uint32_t)g->features[f]);
        r55_put_u64(bytes, 24, g->source_mass); r55_sha256_update(&hash, bytes, sizeof(bytes));
    }
    r55_sha256_final(&hash, counts->feature_digest); timing->receipt = r55d_now() - phase;
    phase = r55d_now();
    if (reference) {
        r55fast_sort_groups(u->groups, u->count);
        for (uint32_t i = 0; i < u->count && selected->count < budget; ++i)
            if (!u->groups[i].evidence_loss) selected->values[selected->count++] = u->groups[i];
    } else {
        for (uint32_t i = 0; i < u->count; ++i)
            if (!u->groups[i].evidence_loss) r55e_keep(selected, &u->groups[i], counts);
        r55fast_sort_groups(selected->values, selected->count);
    }
    counts->selected = selected->count; timing->sort = r55d_now() - phase;
    return 0;
}

static int r55e_search(const r55_public_episode *episode, const r55_affine *target,
    const r55sg_universe *u, const r55e_heap *selected, uint32_t cap,
    r55_search_result *result, r55e_counts *counts)
{
    r55_seen seen = {{0}, {0}};
    result->first_counterexample = UINT32_MAX;
    result->partial_expansions = R55_CANDIDATES + u->count;
    /* The verifier challenge uses syntax order and is shared by every guide. */
    const r55_candidate *injection = NULL;
    for (uint32_t i = 0; i < R55_CANDIDATES; ++i)
        if (!r55_affine_equal(&u->programs[i].candidate.semantic, target)) { injection = &u->programs[i].candidate; break; }
    if (!injection) return 1;
    counts->injection_ast = injection->syntax_index; counts->accepted_ast = UINT32_MAX;
    int state = r55_search_candidate(&seen, injection, target, result, cap);
    if (state != 0) return 1;
    result->invalid_first_rejected = 1;
    for (uint32_t i = 0; i < selected->count; ++i) {
        const r55_candidate *candidate = &u->programs[selected->values[i].representative].candidate;
        ++counts->proposal_attempts;
        state = r55_search_candidate(&seen, candidate, target, result, cap);
        if (state < 0) return 1;
        if (state == 2) counts->accepted_ast = candidate->syntax_index;
        if (state > 0) break;
    }
    if (!result->exact && !result->global_cap_hit) {
        r55_canonical_candidate fallback[R55_CANDIDATES];
        result->fallback_started = 1;
        if (r55_canonical_fallback_order(episode, fallback)) return 1;
        uint32_t before = result->verifier_checks;
        for (uint32_t i = 0; i < R55_CANDIDATES; ++i) {
            const r55_candidate *candidate = &u->programs[fallback[i].syntax_index].candidate;
            ++counts->fallback_attempts;
            state = r55_search_candidate(&seen, candidate, target, result, cap);
            if (state < 0) return 1;
            if (state == 2) counts->accepted_ast = candidate->syntax_index;
            if (state > 0) break;
        }
        counts->fallback_checks = result->verifier_checks - before;
        result->fallback_exhausted = !result->exact && !result->global_cap_hit;
    }
    result->primary_cost = result->exact ? result->verifier_checks : cap + 1;
    return 0;
}

static int r55e_episode(const r55_family *family, uint32_t source, uint32_t tie,
    uint32_t arm, const r55_artifact *artifact, const r55sg_model *model, int reference,
    uint32_t budget, uint32_t cap, int empty, r55_search_result *result,
    r55sg_timing *timing, r55e_counts *counts, r55e_heap *selected, uint32_t *groups)
{
    memset(result, 0, sizeof(*result)); memset(timing, 0, sizeof(*timing)); memset(counts, 0, sizeof(*counts));
    uint64_t start = r55d_now(), cpu = r55d_cpu(), phase = start;
    r55sg_universe *u = calloc(1, sizeof(*u));
    if (!u) return 1;
    int failed = 1;
    r55_public_episode episode; uint8_t roles[8];
    if (r55sg_public(family, &episode, roles)) goto done;
    result->observation_queries = 32;
    if (arm == 5) for (uint32_t slot = 0; slot < 8; ++slot) {
        roles[slot] = 0;
        for (uint32_t other = 0; other < 8; ++other) roles[slot] += episode.surface_id[other] < episode.surface_id[slot];
    }
    timing->adapter = r55d_now() - phase; phase = r55d_now();
    if (r55sg_enumerate(&episode, roles, u)) goto done;
    if (empty) for (uint32_t i = 0; i < R55_CANDIDATES; ++i) u->programs[i].candidate.evidence_loss = 1;
    timing->enumerate = r55d_now() - phase; phase = r55d_now();
    if (r55sg_group_programs(u)) goto done;
    *groups = u->count; timing->group = r55d_now() - phase;
    const r55_guide *guide = arm == 3 || arm == 5 ? &artifact->guides[source] : NULL;
    result->source_artifact_reads = (guide ? R55_CANONICAL_GUIDE_BYTES : 0) + (arm != 1 ? 16 : 0);
    uint64_t salt = r55_mix64(family->family_seed ^ ((uint64_t)source << 48) ^ tie ^ R55_TIE_NAMESPACE);
    if (r55e_plan(u, guide, model->weights[source], arm, salt, budget, reference, selected, counts, timing)) goto done;
    phase = r55d_now();
    r55_sha256 hash; r55_sha256_init(&hash);
    for (uint32_t i = 0; i < selected->count; ++i) {
        uint8_t bytes[4]; r55_put_u32(bytes, 0, selected->values[i].key); r55_sha256_update(&hash, bytes, sizeof(bytes));
    }
    r55_sha256_final(&hash, result->proposal_order); timing->receipt += r55d_now() - phase;
    phase = r55d_now(); failed = r55e_search(&episode, &family->target, u, selected, cap, result, counts);
    timing->search = r55d_now() - phase;
done:
    free(u); timing->wall = r55d_now() - start; timing->cpu = r55d_cpu() - cpu;
    return failed;
}

static void r55e_row(uint32_t index, uint32_t phase, const char *case_name,
    uint32_t budget, uint32_t cap, uint32_t groups, int failed,
    const r55_search_result *r, const r55sg_timing *t, const r55e_counts *c, const r55e_heap *h)
{
    char features[65], order[65], accepted[65];
    r55_hex(c->feature_digest, features); r55_hex(r->proposal_order, order); r55_hex(r->accepted_semantic, accepted);
    printf("{\"kind\":\"row\",\"episode\":%u,\"phase\":\"%s\",\"case\":\"%s\",\"budget\":%u,\"cap\":%u,"
        "\"failed\":%s,\"exact\":%s,\"certificate_valid\":%s,\"injected_invalid_rejected\":%s,"
        "\"injection_ast\":%u,\"accepted_ast\":%u,\"counterexample\":%u,\"groups\":%u,\"eligible_groups\":%u,"
        "\"eligible_programs\":%u,\"program_scans\":%u,\"feature_programs\":%u,\"prior_calls\":%u,\"rich_groups\":%u,"
        "\"scored_groups\":%u,\"heap_comparisons\":%u,\"batches\":%u,\"maximum_batch\":%u,\"selected\":%u,"
        "\"primary_cost\":%u,\"verifier_checks\":%u,\"partial_expansions\":%u,\"proposal_attempts\":%u,"
        "\"fallback_attempts\":%u,\"fallback_checks\":%u,\"fallback_started\":%s,\"global_cap_hit\":%s,\"fallback_exhausted\":%s,"
        "\"observation_queries\":%u,\"source_artifact_reads\":%u,\"features_sha256\":\"%s\",\"proposal_order_sha256\":\"%s\","
        "\"accepted_semantic_sha256\":\"%s\",\"adapter_ns\":%" PRIu64 ",\"enumerate_ns\":%" PRIu64 ",\"group_ns\":%" PRIu64
        ",\"score_ns\":%" PRIu64 ",\"sort_ns\":%" PRIu64 ",\"receipt_ns\":%" PRIu64 ",\"search_ns\":%" PRIu64
        ",\"wall_ns\":%" PRIu64 ",\"cpu_ns\":%" PRIu64 ",\"proposal_keys\":[",
        index, phase ? "measured" : "warmup", case_name, budget, cap, failed ? "true" : "false",
        r->exact ? "true" : "false", r->certificate_valid ? "true" : "false", r->invalid_first_rejected ? "true" : "false",
        c->injection_ast, c->accepted_ast, r->first_counterexample, groups, c->eligible_groups, c->eligible_programs, c->program_scans,
        c->feature_programs, c->prior_calls, c->rich_groups, c->scored_groups, c->comparisons, c->batches, c->maximum_batch, c->selected,
        r->primary_cost, r->verifier_checks, r->partial_expansions, c->proposal_attempts, c->fallback_attempts, c->fallback_checks,
        r->fallback_started ? "true" : "false", r->global_cap_hit ? "true" : "false", r->fallback_exhausted ? "true" : "false",
        r->observation_queries, r->source_artifact_reads, features, order, accepted,
        t->adapter, t->enumerate, t->group, t->score, t->sort, t->receipt, t->search, t->wall, t->cpu);
    for (uint32_t i = 0; i < h->count; ++i) printf("%s%u", i ? "," : "", h->values[i].key);
    puts("]}"); fflush(stdout);
}

static int r55e_heap_check(void)
{
    for (uint32_t count = 0; count <= 257; ++count) {
        r55sg_group reference[257] = {{0}}; r55e_counts counts = {0};
        r55e_heap heap = {{{0}}, 0, R55E_BATCH};
        for (uint32_t i = 0; i < count; ++i) {
            reference[i].key = count - i; reference[i].score = i % 3 ? INT64_MIN : INT64_MAX;
            reference[i].tie = i % 5; r55e_keep(&heap, &reference[i], &counts);
        }
        qsort(reference, count, sizeof(reference[0]), r55sg_group_compare);
        r55fast_sort_groups(heap.values, heap.count);
        if (heap.count != (count < R55E_BATCH ? count : R55E_BATCH)) return 1;
        for (uint32_t i = 0; i < heap.count; ++i)
            if (r55sg_group_compare(&heap.values[i], &reference[i])) return 1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && !strcmp(argv[1], "--heap-check")) return r55e_heap_check();
    int cohort = argc == 2 && !strcmp(argv[1], "cohort");
    if (!cohort && (argc != 4 || strcmp(argv[1], "smoke") ||
        (strcmp(argv[2], "reference") && strcmp(argv[2], "eligible")))) return 2;
    uint32_t arm = 0;
    if (!cohort) {
        for (; arm < R55E_ARMS && strcmp(argv[3], r55e_names[arm]); ++arm) {}
        if (arm == R55E_ARMS) return 2;
    }
    uint64_t started = r55d_now(), cpu = r55d_cpu();
    r55ft_corpus *corpus = calloc(1, sizeof(*corpus));
    if (!corpus) return 1;
    int failed = r55m_make_corpus(corpus, UINT64_C(0x55356d736d6f6b31), 1);
    if (cohort) {
        if (!failed) for (uint32_t cell = 0; cell < 4; ++cell) r55ft_emit_family(corpus, cell * 32);
        free(corpus); return failed;
    }
    r55_artifact artifact = {0}; r55sg_model model = {0};
    if (!failed && arm) failed = r55ft_load_model(&artifact, &model);
    uint64_t preparation_ns = r55d_now() - started, preparation_cpu = r55d_cpu() - cpu;
    printf("{\"kind\":\"metadata\",\"scope\":\"opened_four_family_engineering\",\"arm\":\"%s\",\"planner\":\"%s\","
        "\"seed\":\"55356d736d6f6b31\",\"preparation_ns\":%" PRIu64 ",\"preparation_cpu_ns\":%" PRIu64 "}\n",
        r55e_names[arm], argv[2], preparation_ns, preparation_cpu);
    uint32_t completed = 0;
    for (uint32_t phase = 0; phase < 2 && !failed; ++phase)
        for (uint32_t cell = 0; cell < 4 && !failed; ++cell)
            for (uint32_t view = 0; view < 4 && !failed; ++view) {
                uint32_t index = cell * 128 + view, groups = 0;
                r55_search_result result; r55sg_timing timing; r55e_counts counts; r55e_heap selected = {0};
                failed = r55e_episode(&corpus->families[cell * 32], view / 2, view % 2, r55e_arms[arm], &artifact, &model,
                    !strcmp(argv[2], "reference"), 64, R55_GLOBAL_CAP, 0, &result, &timing, &counts, &selected, &groups);
                failed |= !result.exact || !result.certificate_valid || !result.invalid_first_rejected;
                ++completed; r55e_row(index, phase, "normal", 64, R55_GLOBAL_CAP, groups, failed, &result, &timing, &counts, &selected);
            }
    for (uint32_t test = 0; test < 3 && !failed; ++test) {
        uint32_t groups = 0, budget = test == 0 ? 0 : 64, cap = test == 2 ? 1 : R55_GLOBAL_CAP;
        r55_search_result result; r55sg_timing timing; r55e_counts counts; r55e_heap selected = {0};
        failed = r55e_episode(&corpus->families[0], 0, 0, r55e_arms[arm], &artifact, &model,
            !strcmp(argv[2], "reference"), budget, cap, test == 1, &result, &timing, &counts, &selected, &groups);
        failed |= !result.invalid_first_rejected || (test < 2 ? (!result.exact || !result.fallback_started) : (result.exact || !result.global_cap_hit));
        ++completed; r55e_row(0, 1, test == 0 ? "zero_budget" : test == 1 ? "empty_eligible_set" : "verifier_cap",
            budget, cap, groups, failed, &result, &timing, &counts, &selected);
    }
    free(corpus);
    struct rusage usage; if (getrusage(RUSAGE_SELF, &usage)) return 1;
    uint64_t peak = (uint64_t)usage.ru_maxrss;
#ifndef __APPLE__
    peak *= 1024;
#endif
    printf("{\"kind\":\"process\",\"failed\":%s,\"completed_episodes\":%u,\"peak_rss_bytes\":%" PRIu64
        ",\"process_wall_ns\":%" PRIu64 ",\"process_cpu_ns\":%" PRIu64 "}\n", failed ? "true" : "false", completed,
        peak, r55d_now() - started, r55d_cpu() - cpu);
    return failed || ferror(stdout);
}
