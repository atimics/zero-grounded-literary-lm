#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <time.h>
#include <unistd.h>
#include "reasoner52.c"

#if R5_VARIANT == 53
#define R5_ID "reasoner53-evidence-transfer-v1"
#define R5_APPROVAL "reasoner53-evidence-2026-09-02-v1"
#define R5_CONDITIONS 3u
#elif R5_VARIANT == 54
#define R5_ID "reasoner54-pixel-transfer-v1"
#define R5_APPROVAL "reasoner54-pixel-2026-09-02-v1"
#define R5_CONDITIONS 2u
#else
#error R5_VARIANT must be 53 or 54
#endif

#define R5_ARMS 7u
#define R5_FULL 0u
#define R5_TARGET 1u
#define R5_ABLATED 2u
#define R5_SHUFFLED 3u
#define R5_CHANNEL 4u
#define R5_SOURCE 5u
#define R5_ORACLE 6u
#define R5_EPISODES (12u * 2u * R5_CONDITIONS)

static const char *r5_arm_names[R5_ARMS] = {
    "full", "target_only", "source_ablation", "shuffled_source",
    "channel_ablation", "source_only", "oracle"
};

typedef struct {
    r52_artifact source;
    uint16_t templates[17];
} r5_artifact;

typedef struct {
    uint32_t count;
    uint8_t x[5];
    uint8_t y[5];
    uint8_t control_x[5];
    uint8_t control_y[5];
    uint8_t oracle_x[5];
    uint8_t oracle_y[5];
    uint32_t decoded;
    uint32_t decoded_exact;
    uint32_t minimum_margin;
    int accepted_channel;
} r5_evidence;

typedef struct {
    uint32_t target;
    uint32_t condition;
    uint32_t tie;
    uint32_t expansions[R5_ARMS];
    uint32_t exact[R5_ARMS];
    uint32_t invalid_first;
    uint32_t decoded;
    uint32_t decoded_exact;
    uint32_t minimum_margin;
} r5_episode;

typedef struct {
    r5_episode rows[R5_EPISODES];
    uint32_t sums[R5_CONDITIONS][R5_ARMS];
    uint32_t exact[R5_CONDITIONS][R5_ARMS];
    uint32_t wins[R5_CONDITIONS];
    uint32_t invalid_first;
    uint32_t full_max;
    uint32_t decoded;
    uint32_t decoded_exact;
    uint32_t minimum_margin;
    uint32_t ablation_equal;
    uint32_t oracle_equal;
    uint32_t frozen;
    uint32_t pass;
    uint64_t artifact_digest;
} r5_result;

static unsigned r5_popcount(uint16_t bits) {
    unsigned count = 0;
    while (bits) { count += bits & 1u; bits >>= 1; }
    return count;
}

static uint16_t r5_glyph(uint8_t value) {
    if (value == 16u) return UINT16_MAX;
    uint16_t pixels = 0;
    for (unsigned p = 0; p < 16u; ++p)
        if (r5_popcount((uint16_t)(value & p)) & 1u)
            pixels |= (uint16_t)(1u << p);
    return pixels;
}

static uint16_t r5_sensor(uint16_t glyph) {
    uint16_t rotated = 0;
    for (unsigned p = 0; p < 16u; ++p) {
        unsigned row = p / 4u;
        unsigned col = p % 4u;
        unsigned dest = col * 4u + 3u - row;
        if (glyph & (1u << p)) rotated |= (uint16_t)(1u << dest);
    }
    return (uint16_t)(rotated ^ UINT16_MAX);
}

static uint8_t r5_decode(uint16_t pixels, const uint16_t templates[17],
                         uint32_t *margin) {
    unsigned best = 17u;
    unsigned next = 17u;
    uint8_t value = 0;
    for (uint8_t label = 0; label < 17u; ++label) {
        unsigned distance = r5_popcount((uint16_t)(pixels ^ templates[label]));
        if (distance < best) { next = best; best = distance; value = label; }
        else if (distance < next) next = distance;
    }
    *margin = next - best;
    return value;
}

static void r5_build(r5_artifact *artifact) {
    memset(artifact, 0, sizeof(*artifact));
    r52_build_artifact(&artifact->source);
    if (R5_VARIANT == 54)
        for (uint8_t label = 0; label < 17u; ++label)
            artifact->templates[label] = r5_sensor(r5_glyph(label));
}

static void r5_observe(const uint8_t table[17], uint32_t condition,
                        uint32_t target, uint32_t tie,
                        const r5_artifact *artifact, r5_evidence *e) {
    memset(e, 0, sizeof(*e));
    e->minimum_margin = 17u;
    e->accepted_channel = 1;
    e->count = R5_VARIANT == 53 && condition == 0 ? 5u : 3u;
    uint16_t raw_templates[17];
    for (uint8_t v = 0; v < 17u; ++v) raw_templates[v] = r5_glyph(v);
    for (uint32_t i = 0; i < e->count; ++i) {
        uint8_t x = (uint8_t)(R5_VARIANT == 53 && condition > 0 ? i * 2u : i);
        uint8_t y = table[x];
        e->oracle_x[i] = x;
        e->oracle_y[i] = y;
        if (R5_VARIANT == 53) {
            e->x[i] = x;
            e->y[i] = condition == 2u && i == 1u ? r52_mod(y + 1) : y;
            e->control_x[i] = e->x[i];
            e->control_y[i] = e->y[i];
        } else {
            uint16_t px = r5_sensor(r5_glyph(x));
            uint16_t py = r5_sensor(r5_glyph(y));
            if (condition == 1u) {
                px ^= (uint16_t)(1u << ((target * 7u + i * 3u + tie) % 16u));
                py ^= (uint16_t)(1u << ((target * 7u + i * 3u + tie + 1u) % 16u));
            }
            uint32_t mx, my, unused;
            e->x[i] = r5_decode(px, artifact->templates, &mx);
            e->y[i] = r5_decode(py, artifact->templates, &my);
            e->control_x[i] = r5_decode(px, raw_templates, &unused);
            e->control_y[i] = r5_decode(py, raw_templates, &unused);
            if (mx < e->minimum_margin) e->minimum_margin = mx;
            if (my < e->minimum_margin) e->minimum_margin = my;
            if (mx < 6u || my < 6u) e->accepted_channel = 0;
            e->decoded += 2u;
            e->decoded_exact += (e->x[i] == x) + (e->y[i] == y);
        }
    }
}

static uint32_t r5_rank(const r5_artifact *artifact, const uint8_t target[17],
                         const r5_evidence *e, uint32_t condition,
                         uint32_t target_index, uint32_t tie, uint32_t arm,
                         uint32_t *exact, uint32_t *invalid_first) {
    r52_candidate candidates[R52_CANDIDATES];
    r52_artifact zero;
    memset(&zero, 0, sizeof(zero));
    uint32_t cursor = 0;
    for (uint8_t a = 0; a < 8; ++a)
        for (uint8_t b = 0; b < 8; ++b)
            for (uint8_t c = 0; c < 8; ++c) {
                r52_candidate *candidate = &candidates[cursor++];
                candidate->token[0] = a;
                candidate->token[1] = b;
                candidate->token[2] = c;
                r52_program_table(candidate->token, candidate->table);
                uint32_t loss = 0;
                for (uint32_t i = 0; i < e->count; ++i) {
                    uint8_t x = arm == R5_CHANNEL ? e->control_x[i] : e->x[i];
                    uint8_t y = arm == R5_CHANNEL ? e->control_y[i] : e->y[i];
                    if (R5_VARIANT == 54 && arm == R5_ORACLE) {
                        x = e->oracle_x[i]; y = e->oracle_y[i];
                    }
                    loss += candidate->table[x] != y;
                }
                if (R5_VARIANT == 53 && condition == 2u && arm != R5_CHANNEL)
                    loss = loss > 0u ? loss - 1u : 0u;
                if (arm == R5_SOURCE) loss = 0;
                r52_mode mode = arm == R5_SHUFFLED ? R52_MODE_SHUFFLED_SOURCE : R52_MODE_FULL;
                const r52_artifact *source = arm == R5_ABLATED ? &zero : &artifact->source;
                uint32_t strength = arm == R5_TARGET ? 0u :
                    r52_prior_strength(source, candidate->token, mode);
                candidate->score = (uint64_t)loss * UINT64_C(1000000) + 1000u - strength;
                if (R5_VARIANT == 53 && arm == R5_ORACLE)
                    candidate->score = memcmp(candidate->table, target, 17u) == 0 ? 0u : 1u;
                candidate->tie = r52_hash(candidate->token, 3u,
                    ((uint64_t)target_index << 32) | tie);
            }
    qsort(candidates, R52_CANDIDATES, sizeof(candidates[0]), r52_compare);
    *invalid_first = memcmp(candidates[0].table, target, 17u) != 0;
    *exact = 0;
    for (uint32_t rank = 0; rank < R52_CANDIDATES; ++rank) {
        if (memcmp(candidates[rank].table, target, 17u) == 0) {
            *exact = 1;
            return rank + 1u;
        }
    }
    return R52_CANDIDATES;
}

static int r5_self_test(void) {
    if (r52_self_test() != 0) return 1;
    r5_artifact artifact;
    r5_build(&artifact);
    if (R5_VARIANT == 54) {
        for (uint8_t label = 0; label < 17u; ++label)
            for (unsigned bit = 0; bit < 16u; ++bit) {
                uint32_t margin;
                uint8_t decoded = r5_decode((uint16_t)(artifact.templates[label] ^ (1u << bit)),
                                             artifact.templates, &margin);
                if (decoded != label || margin < 6u) return 1;
            }
    }
    return 0;
}

static void r5_execute(r5_result *result, r5_artifact *artifact) {
    static const uint8_t targets[12][3] = {
        {3,5,6}, {4,0,7}, {5,3,2}, {0,4,1}, {2,3,5}, {1,4,0},
        {6,5,3}, {7,0,4}, {5,6,2}, {0,7,1}, {2,6,5}, {1,7,0}
    };
    memset(result, 0, sizeof(*result));
    r5_build(artifact);
    result->artifact_digest = r52_hash(artifact, sizeof(*artifact), R5_VARIANT);
    result->ablation_equal = 1;
    result->oracle_equal = 1;
    result->minimum_margin = 17u;
    uint32_t row_index = 0;
    for (uint32_t condition = 0; condition < R5_CONDITIONS; ++condition)
        for (uint32_t t = 0; t < 12u; ++t)
            for (uint32_t tie = 0; tie < 2u; ++tie) {
                uint8_t table[17];
                r52_program_table(targets[t], table);
                r5_evidence evidence;
                r5_observe(table, condition, t, tie, artifact, &evidence);
                r5_episode *row = &result->rows[row_index++];
                row->target = t; row->condition = condition; row->tie = tie;
                row->decoded = evidence.decoded;
                row->decoded_exact = evidence.decoded_exact;
                row->minimum_margin = evidence.minimum_margin;
                result->decoded += row->decoded;
                result->decoded_exact += row->decoded_exact;
                if (row->minimum_margin < result->minimum_margin)
                    result->minimum_margin = row->minimum_margin;
                for (uint32_t arm = 0; arm < R5_ARMS; ++arm) {
                    uint32_t invalid;
                    row->expansions[arm] = r5_rank(artifact, table, &evidence,
                        condition, t, tie, arm, &row->exact[arm], &invalid);
                    if (arm == R5_FULL) {
                        row->invalid_first = invalid;
                        if (!evidence.accepted_channel) row->exact[arm] = 0;
                    }
                    result->sums[condition][arm] += row->expansions[arm];
                    result->exact[condition][arm] += row->exact[arm];
                }
                result->invalid_first += row->invalid_first;
                if (row->expansions[R5_FULL] > result->full_max)
                    result->full_max = row->expansions[R5_FULL];
                result->wins[condition] += row->expansions[R5_FULL] < row->expansions[R5_TARGET];
                result->ablation_equal &= row->expansions[R5_TARGET] == row->expansions[R5_ABLATED];
                result->oracle_equal &= row->expansions[R5_FULL] == row->expansions[R5_ORACLE];
            }
    result->frozen = result->artifact_digest == r52_hash(artifact, sizeof(*artifact), R5_VARIANT);
    uint32_t primary = R5_VARIANT == 53 ? 2u : 1u;
    result->pass = result->frozen && result->ablation_equal &&
        result->full_max <= 64u && result->invalid_first > 0u &&
        result->sums[primary][R5_FULL] * 100u <= result->sums[primary][R5_TARGET] * 80u &&
        result->sums[primary][R5_FULL] < result->sums[primary][R5_CHANNEL] &&
        result->sums[primary][R5_FULL] < result->sums[primary][R5_SHUFFLED] &&
        result->wins[primary] >= 12u;
    for (uint32_t c = 0; c < R5_CONDITIONS; ++c)
        for (uint32_t arm = 0; arm < R5_ARMS; ++arm)
            result->pass &= result->exact[c][arm] == 24u;
    if (R5_VARIANT == 54)
        result->pass &= result->decoded_exact == result->decoded &&
                        result->minimum_margin >= 6u && result->oracle_equal;
}

static int r5_write_result(const char *path, const r5_result *r) {
    FILE *f = fopen(path, "wb");
    if (!f) return 1;
    fprintf(f, "{\n  \"schema\": \"reasoner%d-result-v1\",\n  \"experiment\": \"%s\",\n", R5_VARIANT, R5_ID);
    fprintf(f, "  \"decision\": \"%s\",\n  \"gate_pass\": %s,\n", r->pass ? "pass" : "no-go", r->pass ? "true" : "false");
    fprintf(f, "  \"episodes\": %u,\n  \"source_programs\": 16,\n  \"candidate_count\": 512,\n  \"domain_points\": 17,\n", R5_EPISODES);
    fprintf(f, "  \"calibration_glyphs\": %u,\n  \"decoded_values\": %u,\n  \"decoded_exact\": %u,\n  \"minimum_margin\": %u,\n", R5_VARIANT == 54 ? 17u : 0u, r->decoded, r->decoded_exact, r->minimum_margin);
    fprintf(f, "  \"full_max_expansions\": %u,\n  \"invalid_first_suggestions\": %u,\n  \"source_ablation_equal\": %s,\n  \"oracle_equal\": %s,\n  \"artifact_frozen\": %s,\n  \"artifact_digest\": \"%016llx\",\n", r->full_max, r->invalid_first, r->ablation_equal ? "true" : "false", r->oracle_equal ? "true" : "false", r->frozen ? "true" : "false", (unsigned long long)r->artifact_digest);
    fputs("  \"conditions\": [\n", f);
    for (uint32_t c = 0; c < R5_CONDITIONS; ++c) {
        fprintf(f, "    {\"condition\": %u, \"individual_wins\": %u, \"arms\": {", c, r->wins[c]);
        for (uint32_t a = 0; a < R5_ARMS; ++a)
            fprintf(f, "%s\"%s\": {\"expansions\": %u, \"exact\": %u}", a ? ", " : "", r5_arm_names[a], r->sums[c][a], r->exact[c][a]);
        fprintf(f, "}}%s\n", c + 1u == R5_CONDITIONS ? "" : ",");
    }
    fputs("  ],\n  \"episode_rows\": [\n", f);
    for (uint32_t i = 0; i < R5_EPISODES; ++i) {
        const r5_episode *row = &r->rows[i];
        fprintf(f, "    {\"target\": %u, \"condition\": %u, \"tie\": %u, \"invalid_first\": %u, \"decoded\": %u, \"decoded_exact\": %u, \"minimum_margin\": %u, \"arms\": {", row->target, row->condition, row->tie, row->invalid_first, row->decoded, row->decoded_exact, row->minimum_margin);
        for (uint32_t a = 0; a < R5_ARMS; ++a)
            fprintf(f, "%s\"%s\": {\"expansions\": %u, \"exact\": %u}", a ? ", " : "", r5_arm_names[a], row->expansions[a], row->exact[a]);
        fprintf(f, "}}%s\n", i + 1u == R5_EPISODES ? "" : ",");
    }
    fputs("  ]\n}\n", f);
    int failed = ferror(f);
    return fclose(f) != 0 || failed;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        int status = r5_self_test();
        printf("Reasoner %d preflight %s\n", R5_VARIANT, status ? "failed" : "passed");
        return status;
    }
    if (argc != 5 || strcmp(argv[1], "execute") != 0) return 2;
    const char *approval = getenv("REASONER5_APPROVAL");
    const char *lock = getenv("REASONER5_LOCK");
    if (!approval || strcmp(approval, R5_APPROVAL) != 0 || !lock || !*lock) return 3;
    int fd = open(lock, O_WRONLY | O_CREAT | O_EXCL, 0444);
    if (fd < 0) { perror("execution lock"); return 4; }
    const char payload[] = R5_ID " consumed\n";
    int wrote = write(fd, payload, sizeof(payload) - 1u) == (ssize_t)(sizeof(payload) - 1u);
    int closed = close(fd) == 0;
    if (!wrote || !closed) return 5;
    alarm(300);
    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);
    r5_result result;
    r5_artifact artifact;
    r5_execute(&result, &artifact);
    clock_gettime(CLOCK_MONOTONIC, &end);
    double elapsed = (end.tv_sec - start.tv_sec) * 1000.0 + (end.tv_nsec - start.tv_nsec) / 1000000.0;
    if (r5_write_result(argv[2], &result)) return 6;
    FILE *af = fopen(argv[4], "wb");
    if (!af) return 7;
    int artifact_ok = fwrite(&artifact, sizeof(artifact), 1u, af) == 1u;
    if (fclose(af) != 0 || !artifact_ok) return 8;
    FILE *ef = fopen(argv[3], "wb");
    if (!ef) return 9;
    time_t now = time(NULL);
    struct tm utc;
    char stamp[32];
    gmtime_r(&now, &utc);
    strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
    fprintf(ef, "{\n  \"schema\": \"reasoner%d-execution-v1\",\n  \"experiment\": \"%s\",\n  \"approval_id\": \"%s\",\n  \"executed_at_utc\": \"%s\",\n  \"environment\": \"local\",\n  \"execution_count\": 1,\n  \"retry_count\": 0,\n  \"post_open_tuning\": false,\n  \"elapsed_ms\": %.3f,\n  \"cost_usd\": 0,\n  \"decision\": \"%s\"\n}\n", R5_VARIANT, R5_ID, R5_APPROVAL, stamp, elapsed, result.pass ? "pass" : "no-go");
    int failed = ferror(ef);
    if (fclose(ef) != 0 || failed) return 10;
    alarm(0);
    printf("Reasoner %d: %s, %u episodes, %.3f ms\n", R5_VARIANT, result.pass ? "pass" : "no-go", R5_EPISODES, elapsed);
    return 0;
}
