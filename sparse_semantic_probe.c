/*
 * Q3.5 sparse random-feature semantic probe.
 *
 * Feature-level diagnostic only. It reuses the frozen Q3.4 base runtime,
 * features, data, optimizer, seed, and update budget, and changes only the
 * representation between the 1536-dimensional deployment-exact features and
 * the trained 5-class head.
 *
 * Arms, all trained in one process over one feature extraction:
 *   linear -- the unchanged Q3.4 1536-to-5 head (in-run reference)
 *   dense  -- ReLU(P x), P a frozen ternary projection to 6144 units
 *   sparse -- ReLU(P x) with winner-take-all top 307 (the fly ~5% ratio)
 *
 * No candidate is packaged and no runtime claim is made by this probe. The
 * package and canonical gates require a separate registered experiment.
 */

#define main q32_original_main
#include "runtime_operation_head_pilot.c"
#undef main

#include <sys/stat.h>

#define Q35_SCHEMA "zero.zero4_q35_sparse_probe_event.v1"
#define Q35_TOKENS "benchmarks/zero4-q34-semantic-head-v1/mixed-training.tok"
#define Q35_PROJECTION "benchmarks/zero4-q35-sparse-probe-v1/projection.bin"
#define Q35_INPUT 1536
#define Q35_EXPANSION 6144
#define Q35_TOP_K 307
#define Q35_WORKERS 8

typedef struct {
    float value;
    int index;
} Q35Item;

static int q35_item_compare(const void *left, const void *right)
{
    const Q35Item *a = left, *b = right;
    if (a->value > b->value) return -1;
    if (a->value < b->value) return 1;
    return a->index - b->index;
}

/* Dense ReLU(P x) expansion, parallel over records. Writes records x
 * Q35_EXPANSION floats into out. */
static void q35_expand(const float *features, size_t records,
                       const signed char *projection, float *out)
{
    pid_t children[Q35_WORKERS];
    int worker;
    for (worker = 0; worker < Q35_WORKERS; ++worker) {
        pid_t child = fork();
        if (child < 0) q32_fail_path("fork Q3.5 expansion worker", "fork");
        if (child == 0) {
            size_t record;
            for (record = (size_t)worker; record < records;
                 record += Q35_WORKERS) {
                const float *x = features + record * Q35_INPUT;
                float *destination = out + record * Q35_EXPANSION;
                int unit;
                for (unit = 0; unit < Q35_EXPANSION; ++unit) {
                    const signed char *row =
                        projection + (size_t)unit * Q35_INPUT;
                    float sum = 0.0f;
                    int input;
                    for (input = 0; input < Q35_INPUT; ++input) {
                        signed char weight = row[input];
                        if (weight != 0) sum += (float)weight * x[input];
                    }
                    destination[unit] = sum > 0.0f ? sum : 0.0f;
                }
            }
            _exit(0);
        }
        children[worker] = child;
    }
    for (worker = 0; worker < Q35_WORKERS; ++worker) {
        int status;
        if (waitpid(children[worker], &status, 0) != children[worker] ||
            !WIFEXITED(status) || WEXITSTATUS(status) != 0)
            q32_fail("Q3.5 expansion worker failed");
    }
}

/* Winner-take-all mask: keep the top Q35_TOP_K activations per record. */
static void q35_mask_wta(const float *dense, size_t records, float *sparse)
{
    Q35Item *items = q32_alloc(Q35_EXPANSION, sizeof(*items));
    size_t record;
    for (record = 0; record < records; ++record) {
        const float *source = dense + record * Q35_EXPANSION;
        float *destination = sparse + record * Q35_EXPANSION;
        int unit;
        for (unit = 0; unit < Q35_EXPANSION; ++unit) {
            items[unit].value = source[unit];
            items[unit].index = unit;
        }
        qsort(items, Q35_EXPANSION, sizeof(*items), q35_item_compare);
        memset(destination, 0, Q35_EXPANSION * sizeof(float));
        for (unit = 0; unit < Q35_TOP_K; ++unit)
            destination[items[unit].index] = items[unit].value;
    }
    free(items);
}

/* Copy of q32_run with corrected Q3.5 accounting and an arm label. */
static void q35_run(const char *arm, const char *feature_source,
                    const Q32Options *options, const float *features,
                    int feature_dim, uint64_t base_digest)
{
    Q32Head head = {0};
    int *training = q32_alloc(Q32_TRAIN_RECORDS, sizeof(int));
    FILE *events;
    char checkpoint[4096];
    const char *stop_reason = "update-cap";
    int updates_committed = 0, update;
    q32_head_create(&head, feature_dim); q32_shuffle(training);
    for (update = 0; update <= Q32_MAXIMUM_UPDATES; ++update) {
        if (update != 0 && !q32_measurement_update(update)) continue;
        q32_path(checkpoint, sizeof(checkpoint), options->out_prefix, update);
        q32_require_absent(checkpoint);
    }
    q32_require_absent(options->events_path);
    events = fopen(options->events_path, "w");
    if (events == NULL) q32_fail_path("open Q3.5 events", options->events_path);
    fprintf(events,
        "{\"schema\":\"%s\",\"type\":\"start\",\"arm\":\"%s\",\"seed\":%d,"
        "\"base_parameters\":4852992,\"trainable_parameters\":%d,"
        "\"classes\":5,\"feature_dim\":%d,\"feature_source\":\"%s\","
        "\"feature_records\":9500,\"feature_workers\":%d,"
        "\"training_records\":9000,\"holdout_records\":500,"
        "\"maximum_updates\":100,\"measurement_updates\":[0,25,50,100],"
        "\"authorization_sha256\":\"%s\","
        "\"base_runtime_digest\":\"%016llx\"}\n",
        Q35_SCHEMA, arm, Q32_SEED, Q32_CLASSES * (feature_dim + 1),
        feature_dim, feature_source, Q35_WORKERS,
        options->authorization_sha256, (unsigned long long)base_digest);
    q32_path(checkpoint, sizeof(checkpoint), options->out_prefix, 0);
    q32_checkpoint_save(checkpoint, &head, 0, base_digest);
    {
        Q32Measurement measurement = q32_measure(&head, features);
        q32_emit(events, 0, &measurement, base_digest, q32_head_digest(&head));
    }
    for (update = 1; update <= Q32_MAXIMUM_UPDATES; ++update) {
        int sample;
        memset(head.gw, 0, (size_t)feature_dim * Q32_CLASSES * sizeof(float));
        memset(head.gb, 0, Q32_CLASSES * sizeof(float));
        for (sample = 0; sample < Q32_BATCH; ++sample) {
            int offset = (update - 1) * Q32_BATCH + sample;
            int selected = training[offset % Q32_TRAIN_RECORDS];
            q32_example(&head, features + (size_t)selected * feature_dim,
                        selected % Q32_CLASSES, 1.0f / Q32_BATCH, 1, NULL);
        }
        q32_head_update(&head, (uint64_t)update); updates_committed = update;
        if (q32_measurement_update(update)) {
            Q32Measurement measurement = q32_measure(&head, features);
            q32_path(checkpoint, sizeof(checkpoint), options->out_prefix, update);
            q32_checkpoint_save(checkpoint, &head, (uint64_t)update, base_digest);
            q32_emit(events, update, &measurement, base_digest,
                     q32_head_digest(&head));
            if (q32_qualifies(&measurement)) {
                stop_reason = "runtime-feature-holdout-first-hit"; break;
            }
        }
    }
    fprintf(events,
        "{\"schema\":\"%s\",\"type\":\"complete\",\"arm\":\"%s\","
        "\"updates_committed\":%d,\"stop_reason\":\"%s\","
        "\"runtime_feature_checkpoint_available\":%s,"
        "\"packaged_runtime_gate_run\":false,"
        "\"public_quantity_run\":false,\"language_gate_run\":false,"
        "\"promotion_run\":false}\n", Q35_SCHEMA, arm, updates_committed,
        stop_reason, strcmp(stop_reason, "runtime-feature-holdout-first-hit") == 0
                         ? "true" : "false");
    if (fclose(events) != 0)
        q32_fail_path("close Q3.5 events", options->events_path);
    free(training); q32_head_destroy(&head);
}

static void q35_make_directory(const char *path)
{
    if (mkdir(path, 0755) != 0 && errno != EEXIST)
        q32_fail_path("create Q3.5 directory", path);
}

static int q35_self_test(void)
{
    float dense[Q35_EXPANSION] = {0}, sparse[Q35_EXPANSION] = {0};
    int unit;
    for (unit = 0; unit < Q35_EXPANSION; ++unit) dense[unit] = (float)unit;
    q35_mask_wta(dense, 1, sparse);
    for (unit = 0; unit < Q35_EXPANSION; ++unit) {
        if (unit <= Q35_EXPANSION - Q35_TOP_K - 1) {
            if (sparse[unit] != 0.0f) q32_fail("Q3.5 WTA kept a low unit");
        } else if (sparse[unit] != dense[unit]) {
            q32_fail("Q3.5 WTA dropped a high unit");
        }
    }
    if (!q32_self_test(NULL)) q32_fail("Q3.5 inherited self-test failed");
    puts("Q3.5 sparse-probe mechanics self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    Q32Options linear = {0}, dense = {0}, sparse = {0};
    char prefix_linear[4096], events_linear[4096];
    char prefix_dense[4096], events_dense[4096];
    char prefix_sparse[4096], events_sparse[4096];
    char directory[4096];
    unsigned char *package, *token_bytes, *projection_bytes;
    const uint16_t *tokens;
    const signed char *projection;
    size_t package_length, token_bytes_length, token_count;
    size_t projection_length;
    size_t *starts, record_count;
    float *features, *dense_features, *sparse_features;
    uint64_t base_digest;
    int index;
    const char *out = NULL, *authorization = NULL;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return q35_self_test() ? 0 : 1;
    for (index = 1; index < argc; ++index) {
        if (index + 1 >= argc) q32_fail("incomplete Q3.5 option");
        if (strcmp(argv[index], "--out") == 0) out = argv[++index];
        else if (strcmp(argv[index], "--authorization-sha256") == 0)
            authorization = argv[++index];
        else q32_fail("unknown Q3.5 option");
    }
    if (out == NULL || authorization == NULL ||
        strlen(authorization) != 64)
        q32_fail("Q3.5 requires --out and a 64-hex authorization digest");
    {
        int digit;
        for (digit = 0; digit < 64; ++digit)
            if (!isxdigit((unsigned char)authorization[digit]))
                q32_fail("Q3.5 authorization digest is not hexadecimal");
    }
    package = q32_read_file(Q32_RUNTIME_SOURCE, &package_length);
    if (package_length > INT32_MAX || lm_load(package, (int)package_length) != 0)
        q32_fail("Q3.5 could not load fixed quantized runtime source");
    if (q31_feature_dim != Q35_INPUT || config.layers != 6 || config.dim != 256)
        q32_fail("Q3.5 fixed runtime architecture drifted");
    base_digest = q32_digest(package, package_length);
    projection_bytes = q32_read_file(Q35_PROJECTION, &projection_length);
    if (projection_length != (size_t)Q35_EXPANSION * Q35_INPUT)
        q32_fail("Q3.5 projection length drifted");
    projection = (const signed char *)projection_bytes;
    token_bytes = q32_read_file(Q35_TOKENS, &token_bytes_length);
    if ((token_bytes_length & 1U) != 0) q32_fail("Q3.5 token file is truncated");
    tokens = (const uint16_t *)token_bytes;
    token_count = token_bytes_length / sizeof(uint16_t);
    starts = q32_record_starts(tokens, token_count, &record_count);
    features = q32_extract_features(tokens, token_count, starts, record_count,
                                    Q35_INPUT);
    q35_make_directory(out);
#define Q35_ARM(destination, arm, prefix, events)                              \
    do {                                                                       \
        snprintf(directory, sizeof(directory), "%s/" arm, out);                \
        q35_make_directory(directory);                                         \
        snprintf((prefix), 4096, "%s/" arm "/checkpoint", out);                \
        snprintf((events), 4096, "%s/" arm "/events.jsonl", out);              \
        (destination).out_prefix = (prefix);                                   \
        (destination).events_path = (events);                                 \
        (destination).authorization_sha256 = authorization;                    \
    } while (0)
    Q35_ARM(linear, "linear", prefix_linear, events_linear);
    Q35_ARM(dense, "dense", prefix_dense, events_dense);
    Q35_ARM(sparse, "sparse", prefix_sparse, events_sparse);
#undef Q35_ARM
    dense_features = q32_alloc((size_t)Q32_FEATURE_RECORDS * Q35_EXPANSION,
                               sizeof(float));
    sparse_features = q32_alloc((size_t)Q32_FEATURE_RECORDS * Q35_EXPANSION,
                                sizeof(float));
    q35_expand(features, Q32_FEATURE_RECORDS, projection, dense_features);
    q35_mask_wta(dense_features, Q32_FEATURE_RECORDS, sparse_features);
    q35_run("linear", "deployment-exact-quantized-streaming", &linear,
            features, Q35_INPUT, base_digest);
    q35_run("dense", "frozen-dense-expansion", &dense, dense_features,
            Q35_EXPANSION, base_digest);
    q35_run("sparse", "frozen-sparse-expansion-wta", &sparse, sparse_features,
            Q35_EXPANSION, base_digest);
    free(dense_features); free(sparse_features);
    if (munmap(features, (size_t)Q32_FEATURE_RECORDS * Q35_INPUT *
                             sizeof(float)) != 0)
        q32_fail_path("unmap Q3.5 feature cache", "mmap");
    free(starts); free(token_bytes); free(projection_bytes); free(package);
    q31_release(); release_working_memory();
    return 0;
}
