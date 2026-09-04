/* Reuse the fixed development corpus, affine operations, and exact verifier. */
#define main r55sg_diagnostics_main
#include "reasoner55_diagnostics.c"
#undef main
#include <math.h>

enum { R55SG_FEATURES = 4, R55SG_SCALE = 1000000, R55SG_STEPS = 256,
       R55SG_BASE_ARMS = 8, R55SG_ARMS = R55SG_BASE_ARMS + R55_DERANGEMENTS,
       R55SG_PREFIXES = 1 + 8 + 64 + 512 + 4096 };

typedef struct {
    r55_candidate candidate;
    uint16_t group;
    uint8_t prefix_matches;
} r55sg_program;
typedef struct {
    uint32_t key, count, distinct, prefix_matches;
    uint16_t representative;
    uint8_t evidence_loss;
    uint64_t source_mass, tie;
    int32_t features[R55SG_FEATURES];
    int64_t score;
} r55sg_group;
typedef struct {
    r55sg_program programs[R55_CANDIDATES];
    r55sg_group groups[R55_CANDIDATES];
    uint32_t count;
} r55sg_universe;
typedef struct {
    int32_t weights[R55_GENERATORS][R55SG_FEATURES];
    uint8_t training_sha256[32], artifact_sha256[32];
    double initial_loss[R55_GENERATORS], final_loss[R55_GENERATORS];
} r55sg_model;
typedef struct {
    uint64_t adapter, enumerate, group, score, sort, receipt, search, wall, cpu;
} r55sg_timing;
typedef struct {
    uint32_t count, label;
    int32_t (*features)[R55SG_FEATURES];
} r55sg_training_family;

static const char *r55sg_name(uint32_t arm, char buffer[40])
{
    static const char *names[R55SG_BASE_ARMS] = {
        "semantic_uniform", "semantic_frequency", "source_mass", "task_guide",
        "source_ablation", "raw_lexical_task_guide", "oracle_task_guide",
        "task_without_prior_feature"
    };
    if (arm < R55SG_BASE_ARMS) return names[arm];
    snprintf(buffer, 40, "task_shuffled_%02u", arm - R55SG_BASE_ARMS);
    return buffer;
}

static int r55sg_public(const r55_family *family, r55_public_episode *episode,
                        uint8_t roles[R55_ROLES])
{
    r55_affine recovered[R55_ROLES];
    uint32_t checks = 0;
    r55_make_public_episode(family, episode);
    if (r55_reconstruct_adapter(family, recovered, roles, &checks) != 0) return 1;
    memcpy(episode->primitive_by_surface, recovered, sizeof(recovered));
    return 0;
}

static int r55sg_enumerate(const r55_public_episode *episode,
    const uint8_t roles[R55_ROLES], r55sg_universe *universe)
{
    r55_affine maps[R55SG_PREFIXES];
    uint8_t matches[R55SG_PREFIXES];
    uint32_t previous = 0, offset = 1, width = 8;
    maps[0] = r55_identity();
    matches[0] = 0;
    /* A prefix is composed once and reused by all its extensions. */
    for (uint32_t depth = 1; depth <= R55_PROGRAM_LEN; ++depth) {
        for (uint32_t index = 0; index < width; ++index) {
            uint32_t parent = previous + index / 8u;
            uint8_t observed[R55_LANES];
            maps[offset + index] = r55_compose(
                &episode->primitive_by_surface[index % 8u], &maps[parent]);
            r55_apply(&maps[offset + index], episode->example_input, observed);
            uint8_t here = 0;
            for (uint32_t lane = 0; lane < R55_LANES; ++lane)
                here += observed[lane] == episode->example_output[lane];
            matches[offset + index] = matches[parent] + (depth < 4u ? here : 0u);
            if (depth == R55_PROGRAM_LEN) {
                r55sg_program *program = &universe->programs[index];
                r55_candidate *candidate = &program->candidate;
                memset(program, 0, sizeof(*program));
                candidate->syntax_index = (uint16_t)index;
                r55_program_tokens((uint16_t)index, candidate->token);
                for (uint32_t pos = 0; pos < R55_PROGRAM_LEN; ++pos)
                    candidate->role[pos] = roles[candidate->token[pos]];
                candidate->semantic = maps[offset + index];
                candidate->evidence_loss = here != R55_LANES;
                program->prefix_matches = matches[offset + index];
            }
        }
        previous = offset;
        offset += width;
        width *= 8u;
    }
    return offset != R55SG_PREFIXES;
}

static int r55sg_group_programs(r55sg_universe *universe)
{
    uint16_t slots[R55_SEEN_SLOTS];
    memset(slots, 0xff, sizeof(slots));
    universe->count = 0;
    for (uint32_t index = 0; index < R55_CANDIDATES; ++index) {
        r55sg_program *program = &universe->programs[index];
        uint32_t key = r55_semantic_key(&program->candidate.semantic);
        uint32_t slot = (key * UINT32_C(2654435761)) & (R55_SEEN_SLOTS - 1u);
        uint32_t probes = 0;
        while (slots[slot] != UINT16_MAX && universe->groups[slots[slot]].key != key) {
            slot = (slot + 1u) & (R55_SEEN_SLOTS - 1u);
            if (++probes >= R55_SEEN_SLOTS) return 1;
        }
        if (slots[slot] == UINT16_MAX) {
            uint32_t group = universe->count++;
            slots[slot] = (uint16_t)group;
            memset(&universe->groups[group], 0, sizeof(universe->groups[group]));
            universe->groups[group].key = key;
            universe->groups[group].representative = (uint16_t)index;
            universe->groups[group].evidence_loss = program->candidate.evidence_loss;
        }
        program->group = slots[slot];
        ++universe->groups[program->group].count;
    }
    return 0;
}

static void r55sg_features(r55sg_universe *universe, const r55_guide *guide, int rich)
{
    for (uint32_t index = 0; index < R55_CANDIDATES; ++index) {
        const r55sg_program *program = &universe->programs[index];
        r55sg_group *group = &universe->groups[program->group];
        if (guide) group->source_mass += r55_guide_score(guide, program->candidate.role, 0);
        if (rich) {
            uint32_t seen = 0;
            for (uint32_t pos = 0; pos < R55_PROGRAM_LEN; ++pos)
                seen |= 1u << program->candidate.role[pos];
            uint32_t distinct = 0;
            for (uint32_t role = 0; role < R55_ROLES; ++role) distinct += (seen >> role) & 1u;
            group->distinct += distinct == R55_PROGRAM_LEN;
            group->prefix_matches += program->prefix_matches;
        }
    }
    for (uint32_t index = 0; index < universe->count; ++index) {
        r55sg_group *g = &universe->groups[index];
        if (rich) {
            g->features[0] = (int32_t)llround(R55SG_SCALE * log(g->count) / log(R55_CANDIDATES));
            g->features[1] = (int32_t)llround((double)R55SG_SCALE * g->distinct / g->count);
            g->features[2] = (int32_t)llround(R55SG_SCALE * log1p((double)g->source_mass / g->count) /
                (7.0 * log(65.0)));
            g->features[3] = (int32_t)llround((double)R55SG_SCALE * g->prefix_matches / (9.0 * g->count));
        }
    }
}

static int r55sg_group_compare(const void *a, const void *b)
{
    const r55sg_group *left = a, *right = b;
    if (left->evidence_loss != right->evidence_loss)
        return left->evidence_loss < right->evidence_loss ? -1 : 1;
    if (left->score != right->score) return left->score > right->score ? -1 : 1;
    if (left->tie != right->tie) return left->tie < right->tie ? -1 : 1;
    return left->key < right->key ? -1 : left->key > right->key;
}

static void r55sg_feature_digest(const r55sg_universe *u, uint8_t digest[32])
{
    r55_sha256 sha;
    r55_sha256_init(&sha);
    for (uint32_t index = 0; index < u->count; ++index) {
        const r55sg_group *g = &u->groups[index];
        uint8_t bytes[32];
        r55_put_u32(bytes, 0, g->key);
        r55_put_u32(bytes, 4, g->count);
        for (uint32_t f = 0; f < R55SG_FEATURES; ++f)
            r55_put_u32(bytes, 8 + f * 4u, (uint32_t)g->features[f]);
        r55_put_u64(bytes, 24, g->source_mass);
        r55_sha256_update(&sha, bytes, sizeof(bytes));
    }
    r55_sha256_final(&sha, digest);
}

static double r55sg_loss_gradient(const r55sg_training_family *families,
    const double weights[R55SG_FEATURES], double gradient[R55SG_FEATURES])
{
    double loss = 0;
    memset(gradient, 0, R55SG_FEATURES * sizeof(*gradient));
    for (uint32_t task = 0; task < R55_SOURCE_FAMILIES; ++task) {
        const r55sg_training_family *family = &families[task];
        double scores[R55_CANDIDATES], maximum = -INFINITY, total = 0;
        for (uint32_t row = 0; row < family->count; ++row) {
            double score = 0;
            for (uint32_t f = 0; f < R55SG_FEATURES; ++f)
                score += weights[f] * family->features[row][f] / R55SG_SCALE;
            scores[row] = score;
            if (score > maximum) maximum = score;
        }
        for (uint32_t row = 0; row < family->count; ++row)
            total += exp(scores[row] - maximum);
        loss += log(total) + maximum - scores[family->label];
        for (uint32_t row = 0; row < family->count; ++row) {
            double error = exp(scores[row] - maximum) / total - (row == family->label);
            for (uint32_t f = 0; f < R55SG_FEATURES; ++f)
                gradient[f] += error * family->features[row][f] / R55SG_SCALE;
        }
    }
    for (uint32_t f = 0; f < R55SG_FEATURES; ++f) gradient[f] /= R55_SOURCE_FAMILIES;
    return loss / R55_SOURCE_FAMILIES;
}

static int r55sg_train(const r55d_corpus *corpus, r55_artifact *artifact, r55sg_model *model)
{
    r55_sha256 training;
    r55_sha256_init(&training);
    memset(artifact, 0, sizeof(*artifact));
    memset(model, 0, sizeof(*model));
    for (uint32_t gen = 0; gen < R55_GENERATORS; ++gen) {
        r55_guide *guide = &artifact->guides[gen];
        guide->generator_id = (uint8_t)gen;
        for (uint32_t task = 0; task < R55_SOURCE_FAMILIES; ++task) {
            uint8_t solution[R55_PROGRAM_LEN];
            if (r55_canonical_solution(&corpus->source[gen][task], solution) != 0) return 1;
            r55_guide_add(guide, solution);
            ++guide->source_families;
        }
    }
    r55_finish_artifact(artifact);
    for (uint32_t gen = 0; gen < R55_GENERATORS; ++gen) {
        r55sg_training_family families[R55_SOURCE_FAMILIES] = {{0}};
        int failed = 0;
        for (uint32_t task = 0; task < R55_SOURCE_FAMILIES && !failed; ++task) {
            r55sg_universe *u = calloc(1, sizeof(*u));
            r55_public_episode episode;
            uint8_t roles[R55_ROLES];
            const r55_family *family = &corpus->source[gen][task];
            if (!u || r55sg_public(family, &episode, roles) != 0 ||
                r55sg_enumerate(&episode, roles, u) != 0 || r55sg_group_programs(u) != 0) {
                free(u); failed = 1; break;
            }
            r55sg_features(u, &artifact->guides[gen], 1);
            r55sg_training_family *target = &families[task];
            target->features = calloc(u->count, sizeof(*target->features));
            target->label = UINT32_MAX;
            if (!target->features) { free(u); failed = 1; break; }
            uint8_t digest[32];
            r55sg_feature_digest(u, digest);
            r55_sha256_update(&training, digest, sizeof(digest));
            for (uint32_t g = 0; g < u->count; ++g) {
                const r55sg_group *group = &u->groups[g];
                if (group->evidence_loss) continue;
                if (group->key == r55_semantic_key(&family->target)) target->label = target->count;
                memcpy(target->features[target->count++], group->features, sizeof(group->features));
            }
            uint8_t label_bytes[8];
            r55_put_u32(label_bytes, 0, target->count);
            r55_put_u32(label_bytes, 4, target->label);
            r55_sha256_update(&training, label_bytes, sizeof(label_bytes));
            if (target->label == UINT32_MAX || target->count == 0) failed = 1;
            free(u);
        }
        if (!failed) {
            double weights[R55SG_FEATURES] = {log(R55_CANDIDATES), 0, 0, 0};
            double gradient[R55SG_FEATURES];
            model->initial_loss[gen] = r55sg_loss_gradient(families, weights, gradient);
            for (uint32_t step = 0; step < R55SG_STEPS; ++step) {
                r55sg_loss_gradient(families, weights, gradient);
                for (uint32_t f = 0; f < R55SG_FEATURES; ++f) {
                    double initial = f == 0 ? log(R55_CANDIDATES) : 0;
                    weights[f] -= 0.5 * (gradient[f] + 0.01 * (weights[f] - initial));
                }
            }
            for (uint32_t f = 0; f < R55SG_FEATURES; ++f) {
                if (!isfinite(weights[f]) || fabs(weights[f]) > 1000) { failed = 1; break; }
                model->weights[gen][f] = (int32_t)llround(weights[f] * R55SG_SCALE);
                weights[f] = (double)model->weights[gen][f] / R55SG_SCALE;
            }
            model->final_loss[gen] = r55sg_loss_gradient(families, weights, gradient);
            if (!isfinite(model->final_loss[gen]) ||
                model->final_loss[gen] > model->initial_loss[gen]) failed = 1;
        }
        for (uint32_t task = 0; task < R55_SOURCE_FAMILIES; ++task) free(families[task].features);
        if (failed) return 1;
    }
    r55_sha256_final(&training, model->training_sha256);
    r55_sha256 sha;
    uint8_t bytes[R55_ARTIFACT_MAX_BYTES];
    size_t count = r55_artifact_bytes(artifact, bytes);
    r55_sha256_init(&sha);
    r55_sha256_update(&sha, (const uint8_t *)"R55T0001", 8);
    r55_sha256_update(&sha, bytes, count);
    for (uint32_t gen = 0; gen < R55_GENERATORS; ++gen)
        for (uint32_t f = 0; f < R55SG_FEATURES; ++f) {
            r55_put_u32(bytes, 0, (uint32_t)model->weights[gen][f]);
            r55_sha256_update(&sha, bytes, 4);
        }
    r55_sha256_final(&sha, model->artifact_sha256);
    return 0;
}

static int r55sg_search(const r55_public_episode *episode, const r55_affine *target,
    r55sg_universe *universe, r55_search_result *result)
{
    r55_seen seen = {{0}, {0}};
    result->first_counterexample = UINT32_MAX;
    result->partial_expansions = R55_CANDIDATES + universe->count;
    const r55_candidate *injected = NULL;
    for (uint32_t index = 0; index < universe->count; ++index) {
        const r55_candidate *candidate = &universe->programs[universe->groups[index].representative].candidate;
        if (!r55_affine_equal(&candidate->semantic, target)) { injected = candidate; break; }
    }
    if (!injected || r55_search_candidate(&seen, injected, target, result, R55_GLOBAL_CAP) != 0) return 1;
    result->invalid_first_rejected = 1;
    for (uint32_t index = 0; index < R55_PROPOSAL_BUDGET && index < universe->count; ++index) {
        const r55_candidate *candidate = &universe->programs[universe->groups[index].representative].candidate;
        int state = r55_search_candidate(&seen, candidate, target, result, R55_GLOBAL_CAP);
        if (state < 0) return 1;
        if (state > 0) break;
    }
    if (!result->exact && !result->global_cap_hit) {
        r55_canonical_candidate fallback[R55_CANDIDATES];
        result->fallback_started = 1;
        if (r55_canonical_fallback_order(episode, fallback) != 0) return 1;
        for (uint32_t index = 0; index < R55_CANDIDATES; ++index) {
            int state = r55_search_candidate(&seen,
                &universe->programs[fallback[index].syntax_index].candidate,
                target, result, R55_GLOBAL_CAP);
            if (state < 0) return 1;
            if (state > 0) break;
        }
        result->fallback_exhausted = !result->exact && !result->global_cap_hit;
    }
    result->primary_cost = result->exact ? result->verifier_checks : R55_GLOBAL_CAP + 1;
    return 0;
}

static int r55sg_episode(const r55_family *family, uint32_t source, uint32_t tie,
    uint32_t arm, const r55d_corpus *corpus, const r55_artifact *artifact,
    const r55sg_model *model, r55_search_result *result, r55sg_timing *timing,
    uint32_t *group_count, uint8_t features_sha256[32])
{
    memset(result, 0, sizeof(*result));
    memset(timing, 0, sizeof(*timing));
    uint64_t cpu = r55d_cpu(), wall = r55d_now();
    r55sg_universe *u = calloc(1, sizeof(*u));
    if (!u) return 1;
    uint64_t phase = r55d_now();
    r55_public_episode episode;
    uint8_t roles[R55_ROLES];
    if (r55sg_public(family, &episode, roles) != 0) { free(u); return 1; }
    result->observation_queries = 32;
    timing->adapter = r55d_now() - phase;
    if (arm == 5) {
        for (uint32_t slot = 0; slot < R55_ROLES; ++slot) {
            roles[slot] = 0;
            for (uint32_t other = 0; other < R55_ROLES; ++other)
                roles[slot] += episode.surface_id[other] < episode.surface_id[slot];
        }
    } else if (arm == 6) memcpy(roles, family->surface_to_role, sizeof(roles));
    else if (arm >= R55SG_BASE_ARMS)
        for (uint32_t slot = 0; slot < R55_ROLES; ++slot)
            roles[slot] = corpus->derangements[arm - R55SG_BASE_ARMS][roles[slot]];
    uint64_t salt = r55_mix64(family->family_seed ^ ((uint64_t)source << 48u) ^ tie ^ R55_TIE_NAMESPACE);
    int rich = arm == 3 || arm >= 5;
    const r55_guide *guide = (arm == 2 || rich) && arm != 7 ? &artifact->guides[source] : NULL;
    result->source_artifact_reads = (guide ? R55_CANONICAL_GUIDE_BYTES : 0) +
        (rich ? sizeof(model->weights[source]) : 0);
    phase = r55d_now();
    if (r55sg_enumerate(&episode, roles, u) != 0) { free(u); return 1; }
    timing->enumerate = r55d_now() - phase;
    phase = r55d_now();
    if (r55sg_group_programs(u) != 0) { free(u); return 1; }
    timing->group = r55d_now() - phase;
    phase = r55d_now();
    r55sg_features(u, guide, rich);
    for (uint32_t index = 0; index < u->count; ++index) {
        r55sg_group *g = &u->groups[index];
        g->tie = r55_mix64(salt ^ ((uint64_t)g->key * UINT64_C(0x9e3779b97f4a7c15)));
        if (arm == 1 || arm == 4) g->score = g->count;
        else if (arm == 2) g->score = (int64_t)g->source_mass;
        else if (rich)
            for (uint32_t f = 0; f < R55SG_FEATURES; ++f)
                g->score += (int64_t)model->weights[source][f] * g->features[f];
    }
    timing->score = r55d_now() - phase;
    phase = r55d_now();
    r55sg_feature_digest(u, features_sha256);
    timing->receipt = r55d_now() - phase;
    phase = r55d_now();
    qsort(u->groups, u->count, sizeof(u->groups[0]), r55sg_group_compare);
    timing->sort = r55d_now() - phase;
    phase = r55d_now();
    r55_sha256 order;
    r55_sha256_init(&order);
    for (uint32_t index = 0; index < u->count; ++index) {
        uint8_t bytes[4];
        r55_put_u32(bytes, 0, u->groups[index].key);
        r55_sha256_update(&order, bytes, sizeof(bytes));
    }
    r55_sha256_final(&order, result->proposal_order);
    timing->receipt += r55d_now() - phase;
    phase = r55d_now();
    int failed = r55sg_search(&episode, &family->target, u, result);
    timing->search = r55d_now() - phase;
    *group_count = u->count;
    free(u);
    timing->wall = r55d_now() - wall;
    timing->cpu = r55d_cpu() - cpu;
    return failed || !result->exact || !result->certificate_valid || !result->invalid_first_rejected;
}

static int r55sg_run(uint32_t arm, uint32_t repeats)
{
    r55d_corpus corpus;
    r55_artifact artifact;
    r55sg_model model;
    uint64_t start = r55d_now();
    if (r55d_make_corpus(&corpus) != 0) return 1;
    uint64_t corpus_ns = r55d_now() - start;
    start = r55d_now();
    if (r55sg_train(&corpus, &artifact, &model) != 0) return 1;
    uint64_t training_ns = r55d_now() - start;
    char name[40], artifact_hash[65], training_hash[65], source_hash[65];
    r55_hex(model.artifact_sha256, artifact_hash);
    r55_hex(model.training_sha256, training_hash);
    r55_hex(artifact.digest, source_hash);
    printf("{\"kind\":\"metadata\",\"schema\":\"zero.reasoner55_semantic_guide.v1\","
        "\"lane\":\"development\",\"arm\":\"%s\",\"repeats\":%u,\"warmup_passes\":1,"
        "\"corpus_ns\":%" PRIu64 ",\"training_ns\":%" PRIu64 ","
        "\"source_artifact_sha256\":\"%s\",\"artifact_sha256\":\"%s\","
        "\"training_sha256\":\"%s\",\"artifact_bytes\":1863,\"weights\":[",
        r55sg_name(arm, name), repeats, corpus_ns, training_ns, source_hash, artifact_hash, training_hash);
    for (uint32_t gen = 0; gen < R55_GENERATORS; ++gen) {
        printf("%s[", gen ? "," : "");
        for (uint32_t f = 0; f < R55SG_FEATURES; ++f)
            printf("%s%d", f ? "," : "", model.weights[gen][f]);
        printf("]");
    }
    printf("],\"initial_loss\":[%.12f,%.12f],\"final_loss\":[%.12f,%.12f]}\n",
        model.initial_loss[0], model.initial_loss[1], model.final_loss[0], model.final_loss[1]);
    for (uint32_t repeat = 0; repeat <= repeats; ++repeat)
        for (uint32_t gen = 0; gen < R55_GENERATORS; ++gen)
            for (uint32_t task = 0; task < R55_DEVELOPMENT_FAMILIES; ++task)
                for (uint32_t source = 0; source < R55_GENERATORS; ++source)
                    for (uint32_t tie = 0; tie < R55_TIE_REPEATS; ++tie) {
                        r55_search_result result;
                        r55sg_timing timing;
                        uint32_t groups;
                        uint8_t feature_digest[32];
                        const r55_family *family = &corpus.development[gen][task];
                        if (r55sg_episode(family, source, tie, arm, &corpus, &artifact,
                            &model, &result, &timing, &groups, feature_digest) != 0) return 1;
                        if (repeat == 0) continue;
                        char order[65], accepted[65], features[65];
                        r55_hex(result.proposal_order, order);
                        r55_hex(result.accepted_semantic, accepted);
                        r55_hex(feature_digest, features);
                        printf("{\"kind\":\"measurement\",\"target_generator\":%u,\"ordinal\":%u,"
                            "\"source_generator\":%u,\"tie\":%u,\"repeat\":%u,\"groups\":%u,"
                            "\"family_seed\":\"%016" PRIx64 "\",\"primary_cost\":%u,"
                            "\"verifier_checks\":%u,\"partial_expansions\":%u,"
                            "\"observation_queries\":%u,\"source_artifact_reads\":%u,"
                            "\"exact\":true,\"certificate_valid\":true,\"injected_invalid_rejected\":true,"
                            "\"fallback_started\":%s,\"global_cap_hit\":%s,\"fallback_exhausted\":%s,"
                            "\"injected_counterexample_index\":%u,\"proposal_order_sha256\":\"%s\","
                            "\"accepted_semantic_sha256\":\"%s\",\"features_sha256\":\"%s\","
                            "\"adapter_ns\":%" PRIu64 ",\"enumerate_ns\":%" PRIu64 ","
                            "\"group_ns\":%" PRIu64 ",\"score_ns\":%" PRIu64 ",\"sort_ns\":%" PRIu64 ","
                            "\"receipt_ns\":%" PRIu64 ",\"search_ns\":%" PRIu64 ","
                            "\"wall_ns\":%" PRIu64 ",\"cpu_ns\":%" PRIu64 "}\n",
                            gen, task, source, tie, repeat - 1u, groups, family->family_seed,
                            result.primary_cost, result.verifier_checks, result.partial_expansions,
                            result.observation_queries, result.source_artifact_reads,
                            result.fallback_started ? "true" : "false", result.global_cap_hit ? "true" : "false",
                            result.fallback_exhausted ? "true" : "false", result.first_counterexample,
                            order, accepted, features, timing.adapter, timing.enumerate, timing.group,
                            timing.score, timing.sort, timing.receipt, timing.search, timing.wall, timing.cpu);
                    }
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) != 0) return 1;
    uint64_t peak = (uint64_t)usage.ru_maxrss;
#ifndef __APPLE__
    peak *= 1024u;
#endif
    printf("{\"kind\":\"process\",\"peak_rss_bytes\":%" PRIu64 "}\n", peak);
    return ferror(stdout) ? 1 : 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--list-arms") == 0) {
        for (uint32_t arm = 0; arm < R55SG_ARMS; ++arm) {
            char name[40]; puts(r55sg_name(arm, name));
        }
        return 0;
    }
    if (argc == 4 && strcmp(argv[1], "development") == 0) {
        char *end; errno = 0;
        unsigned long repeats = strtoul(argv[3], &end, 10);
        if (errno || !argv[3][0] || *end || repeats < 1 || repeats > 31) return 2;
        for (uint32_t arm = 0; arm < R55SG_ARMS; ++arm) {
            char name[40];
            if (strcmp(argv[2], r55sg_name(arm, name)) == 0)
                return r55sg_run(arm, (uint32_t)repeats);
        }
    }
    fprintf(stderr, "usage: %s --list-arms | development ARM REPEATS(1..31)\n", argv[0]);
    return 2;
}
