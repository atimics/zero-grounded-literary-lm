#include <ctype.h>

#define Q28_AUDIT_NO_MAIN
#include "graded_plasticity_audit.c"

#define Q30_SCHEMA "zero.zero4_q30_quantity_adapter_event.v1"
#define Q30_INIT "teachers/zero3-balanced-final.teacher"
#define Q30_QUANTITY "corpus/faculty/q22/quantity-request.tok"
#define Q30_RANK 4
#define Q30_SEED 2
#define Q30_MAXIMUM_UPDATES 200
#define Q30_MEASUREMENT_CADENCE 50
#define Q30_BATCH 2
#define Q30_MEASURE_SAMPLES 4
#define Q30_LEARNING_RATE 0.00002f
#define Q30_WEIGHT_DECAY 0.01f
#define Q30_CLIP 1.0f
#define Q30_QUANTITY_IMPROVEMENT_MINIMUM 0.8

typedef struct {
    int input;
    int output;
    float *a;
    float *b;
    float *ga;
    float *gb;
    float *ma;
    float *mb;
    float *va;
    float *vb;
    float *effective;
} Q30LowRankMatrix;

typedef struct {
    Q30LowRankMatrix w1;
    Q30LowRankMatrix w2;
} Q30Layer;

typedef struct {
    int layers;
    int rank;
    Q30Layer *layer;
} Q30Adapter;

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t vocab;
    uint32_t context;
    uint32_t dim;
    uint32_t layers;
    uint32_t ff;
    uint32_t rank;
    uint64_t step;
    uint64_t base_state_digest;
    uint64_t adapter_parameters;
} Q30CheckpointHeader;

typedef struct {
    const char *out_prefix;
    const char *events_path;
    const char *authorization_sha256;
} Q30Options;

typedef struct {
    double quantity_loss;
    double replay_loss;
} Q30Measurement;

static const char Q30_CHECKPOINT_MAGIC[8] =
    {'Q', '3', '0', 'L', 'O', 'R', 'A', '1'};

static size_t q30_matrix_parameters(const Q30LowRankMatrix *matrix, int rank)
{
    return (size_t)rank * (matrix->input + matrix->output);
}

static void q30_matrix_create(Q30LowRankMatrix *matrix, int input,
                              int output, int rank, Rng *rng)
{
    size_t a_count = (size_t)rank * input;
    size_t b_count = (size_t)output * rank;
    size_t weight_count = (size_t)input * output;
    float scale = sqrtf(6.0f / (input + rank));
    size_t index;
    matrix->input = input;
    matrix->output = output;
    matrix->a = zero_alloc(a_count, sizeof(float));
    matrix->b = zero_alloc(b_count, sizeof(float));
    matrix->ga = zero_alloc(a_count, sizeof(float));
    matrix->gb = zero_alloc(b_count, sizeof(float));
    matrix->ma = zero_alloc(a_count, sizeof(float));
    matrix->mb = zero_alloc(b_count, sizeof(float));
    matrix->va = zero_alloc(a_count, sizeof(float));
    matrix->vb = zero_alloc(b_count, sizeof(float));
    matrix->effective = zero_alloc(weight_count, sizeof(float));
    for (index = 0; index < a_count; ++index) {
        matrix->a[index] = rng_symmetric(rng, scale);
    }
    /* B is exactly zero, so enabling the adapter is initially a no-op. */
}

static void q30_matrix_destroy(Q30LowRankMatrix *matrix)
{
    free(matrix->a); free(matrix->b); free(matrix->ga); free(matrix->gb);
    free(matrix->ma); free(matrix->mb); free(matrix->va); free(matrix->vb);
    free(matrix->effective);
    memset(matrix, 0, sizeof(*matrix));
}

static void q30_adapter_create(Q30Adapter *adapter, const Model *model,
                               Rng *rng)
{
    int layer;
    adapter->layers = model->cfg.layers;
    adapter->rank = Q30_RANK;
    adapter->layer = zero_alloc((size_t)adapter->layers,
                                sizeof(*adapter->layer));
    for (layer = 0; layer < adapter->layers; ++layer) {
        q30_matrix_create(&adapter->layer[layer].w1, model->cfg.dim,
                          model->cfg.ff, adapter->rank, rng);
        q30_matrix_create(&adapter->layer[layer].w2, model->cfg.ff,
                          model->cfg.dim, adapter->rank, rng);
    }
}

static void q30_adapter_destroy(Q30Adapter *adapter)
{
    int layer;
    for (layer = 0; layer < adapter->layers; ++layer) {
        q30_matrix_destroy(&adapter->layer[layer].w1);
        q30_matrix_destroy(&adapter->layer[layer].w2);
    }
    free(adapter->layer);
    memset(adapter, 0, sizeof(*adapter));
}

static size_t q30_adapter_parameter_total(const Q30Adapter *adapter)
{
    size_t total = 0;
    int layer;
    for (layer = 0; layer < adapter->layers; ++layer) {
        total += q30_matrix_parameters(&adapter->layer[layer].w1,
                                       adapter->rank);
        total += q30_matrix_parameters(&adapter->layer[layer].w2,
                                       adapter->rank);
    }
    return total;
}

static void q30_matrix_activate(Q30LowRankMatrix *matrix, Parameter *base,
                                int rank)
{
    int output;
    int input;
    int low;
    for (output = 0; output < matrix->output; ++output) {
        for (input = 0; input < matrix->input; ++input) {
            float delta = 0.0f;
            for (low = 0; low < rank; ++low) {
                delta += matrix->b[output * rank + low] *
                         matrix->a[low * matrix->input + input];
            }
            matrix->effective[output * matrix->input + input] =
                base->w[output * matrix->input + input] + delta;
        }
    }
    base->w = matrix->effective;
}

static void q30_adapter_activate(Q30Adapter *adapter, Model *model,
                                 float **base_w1, float **base_w2)
{
    int layer;
    for (layer = 0; layer < adapter->layers; ++layer) {
        base_w1[layer] = model->layer[layer].w1.w;
        base_w2[layer] = model->layer[layer].w2.w;
        q30_matrix_activate(&adapter->layer[layer].w1,
                            &model->layer[layer].w1, adapter->rank);
        q30_matrix_activate(&adapter->layer[layer].w2,
                            &model->layer[layer].w2, adapter->rank);
    }
}

static void q30_adapter_deactivate(Model *model, float **base_w1,
                                   float **base_w2)
{
    int layer;
    for (layer = 0; layer < model->cfg.layers; ++layer) {
        model->layer[layer].w1.w = base_w1[layer];
        model->layer[layer].w2.w = base_w2[layer];
    }
}

static void q30_matrix_accumulate_gradient(Q30LowRankMatrix *matrix,
                                           const Parameter *base, int rank,
                                           float scale)
{
    int output;
    int input;
    int low;
    for (output = 0; output < matrix->output; ++output) {
        for (low = 0; low < rank; ++low) {
            float sum = 0.0f;
            for (input = 0; input < matrix->input; ++input) {
                sum += base->g[output * matrix->input + input] *
                       matrix->a[low * matrix->input + input];
            }
            matrix->gb[output * rank + low] += scale * sum;
        }
    }
    for (low = 0; low < rank; ++low) {
        for (input = 0; input < matrix->input; ++input) {
            float sum = 0.0f;
            for (output = 0; output < matrix->output; ++output) {
                sum += matrix->b[output * rank + low] *
                       base->g[output * matrix->input + input];
            }
            matrix->ga[low * matrix->input + input] += scale * sum;
        }
    }
}

static void q30_adapter_zero_grad(Q30Adapter *adapter)
{
    int layer;
    for (layer = 0; layer < adapter->layers; ++layer) {
        Q30LowRankMatrix *matrices[2] = {
            &adapter->layer[layer].w1, &adapter->layer[layer].w2};
        int index;
        for (index = 0; index < 2; ++index) {
            Q30LowRankMatrix *matrix = matrices[index];
            memset(matrix->ga, 0,
                   (size_t)adapter->rank * matrix->input * sizeof(float));
            memset(matrix->gb, 0,
                   (size_t)matrix->output * adapter->rank * sizeof(float));
        }
    }
}

static void q30_adapter_accumulate_gradient(Q30Adapter *adapter,
                                            const Model *model, float scale)
{
    int layer;
    for (layer = 0; layer < adapter->layers; ++layer) {
        q30_matrix_accumulate_gradient(&adapter->layer[layer].w1,
                                       &model->layer[layer].w1,
                                       adapter->rank, scale);
        q30_matrix_accumulate_gradient(&adapter->layer[layer].w2,
                                       &model->layer[layer].w2,
                                       adapter->rank, scale);
    }
}

static double q30_gradient_sum_squares(const Q30Adapter *adapter)
{
    double total = 0.0;
    int layer;
    for (layer = 0; layer < adapter->layers; ++layer) {
        const Q30LowRankMatrix *matrices[2] = {
            &adapter->layer[layer].w1, &adapter->layer[layer].w2};
        int index;
        for (index = 0; index < 2; ++index) {
            const Q30LowRankMatrix *matrix = matrices[index];
            size_t a_count = (size_t)adapter->rank * matrix->input;
            size_t b_count = (size_t)matrix->output * adapter->rank;
            size_t element;
            for (element = 0; element < a_count; ++element)
                total += matrix->ga[element] * matrix->ga[element];
            for (element = 0; element < b_count; ++element)
                total += matrix->gb[element] * matrix->gb[element];
        }
    }
    return total;
}

static void q30_adam_array(float *weights, const float *gradient, float *m,
                           float *v, size_t count, uint64_t step,
                           float clip_scale)
{
    const float beta1 = 0.9f;
    const float beta2 = 0.999f;
    const float epsilon = 1.0e-8f;
    float correction = sqrtf(1.0f - powf(beta2, (float)step)) /
                       (1.0f - powf(beta1, (float)step));
    size_t index;
    for (index = 0; index < count; ++index) {
        float g = gradient[index] * clip_scale;
        m[index] = beta1 * m[index] + (1.0f - beta1) * g;
        v[index] = beta2 * v[index] + (1.0f - beta2) * g * g;
        weights[index] *= 1.0f - Q30_LEARNING_RATE * Q30_WEIGHT_DECAY;
        weights[index] -= Q30_LEARNING_RATE * correction * m[index] /
                          (sqrtf(v[index]) + epsilon);
    }
}

static void q30_adapter_update(Q30Adapter *adapter, uint64_t step)
{
    double sum_squares = q30_gradient_sum_squares(adapter);
    float norm = (float)sqrt(sum_squares);
    float clip_scale = norm > Q30_CLIP ? Q30_CLIP / norm : 1.0f;
    int layer;
    for (layer = 0; layer < adapter->layers; ++layer) {
        Q30LowRankMatrix *matrices[2] = {
            &adapter->layer[layer].w1, &adapter->layer[layer].w2};
        int index;
        for (index = 0; index < 2; ++index) {
            Q30LowRankMatrix *matrix = matrices[index];
            size_t a_count = (size_t)adapter->rank * matrix->input;
            size_t b_count = (size_t)matrix->output * adapter->rank;
            q30_adam_array(matrix->a, matrix->ga, matrix->ma, matrix->va,
                           a_count, step, clip_scale);
            q30_adam_array(matrix->b, matrix->gb, matrix->mb, matrix->vb,
                           b_count, step, clip_scale);
        }
    }
}

static uint64_t q30_adapter_digest(const Q30Adapter *adapter)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    int layer;
    for (layer = 0; layer < adapter->layers; ++layer) {
        const Q30LowRankMatrix *matrices[2] = {
            &adapter->layer[layer].w1, &adapter->layer[layer].w2};
        int index;
        for (index = 0; index < 2; ++index) {
            const Q30LowRankMatrix *matrix = matrices[index];
            size_t a = (size_t)adapter->rank * matrix->input * sizeof(float);
            size_t b = (size_t)matrix->output * adapter->rank * sizeof(float);
            hash = hash_bytes(hash, matrix->a, a);
            hash = hash_bytes(hash, matrix->b, b);
            hash = hash_bytes(hash, matrix->ma, a);
            hash = hash_bytes(hash, matrix->mb, b);
            hash = hash_bytes(hash, matrix->va, a);
            hash = hash_bytes(hash, matrix->vb, b);
        }
    }
    return hash;
}

static int q30_write(FILE *file, const void *data, size_t size, size_t count)
{
    return fwrite(data, size, count, file) == count;
}

static void q30_checkpoint_save(const char *path, const Model *model,
                                const Q30Adapter *adapter, uint64_t step,
                                uint64_t base_digest)
{
    Q30CheckpointHeader header;
    char *temporary = zero_alloc(strlen(path) + 5, 1);
    FILE *file;
    int layer;
    snprintf(temporary, strlen(path) + 5, "%s.tmp", path);
    file = fopen(temporary, "wb");
    if (file == NULL) fail_path("create Q3.0 checkpoint", temporary);
    memset(&header, 0, sizeof(header));
    memcpy(header.magic, Q30_CHECKPOINT_MAGIC, sizeof(header.magic));
    header.version = 1;
    header.vocab = (uint32_t)model->cfg.vocab;
    header.context = (uint32_t)model->cfg.context;
    header.dim = (uint32_t)model->cfg.dim;
    header.layers = (uint32_t)model->cfg.layers;
    header.ff = (uint32_t)model->cfg.ff;
    header.rank = (uint32_t)adapter->rank;
    header.step = step;
    header.base_state_digest = base_digest;
    header.adapter_parameters = q30_adapter_parameter_total(adapter);
    if (!q30_write(file, &header, sizeof(header), 1))
        fail_path("write Q3.0 checkpoint", temporary);
    for (layer = 0; layer < adapter->layers; ++layer) {
        const Q30LowRankMatrix *matrices[2] = {
            &adapter->layer[layer].w1, &adapter->layer[layer].w2};
        int index;
        for (index = 0; index < 2; ++index) {
            const Q30LowRankMatrix *matrix = matrices[index];
            size_t a = (size_t)adapter->rank * matrix->input;
            size_t b = (size_t)matrix->output * adapter->rank;
            if (!q30_write(file, matrix->a, sizeof(float), a) ||
                !q30_write(file, matrix->b, sizeof(float), b) ||
                !q30_write(file, matrix->ma, sizeof(float), a) ||
                !q30_write(file, matrix->mb, sizeof(float), b) ||
                !q30_write(file, matrix->va, sizeof(float), a) ||
                !q30_write(file, matrix->vb, sizeof(float), b))
                fail_path("write Q3.0 checkpoint", temporary);
        }
    }
    if (fclose(file) != 0 || rename(temporary, path) != 0)
        fail_path("install Q3.0 checkpoint", path);
    free(temporary);
}

static int q30_hex_sha256(const char *value)
{
    int index;
    if (value == NULL || strlen(value) != 64) return 0;
    for (index = 0; index < 64; ++index) {
        if (!((value[index] >= '0' && value[index] <= '9') ||
              (value[index] >= 'a' && value[index] <= 'f'))) return 0;
    }
    return 1;
}

static void q30_validate_options(const Q30Options *options)
{
    if (options->out_prefix == NULL || options->events_path == NULL ||
        !q30_hex_sha256(options->authorization_sha256))
        fail("Q3.0 pilot requires output paths and authorization SHA-256");
    if (strstr(options->out_prefix, "promotion") != NULL ||
        strstr(options->events_path, "promotion") != NULL ||
        strstr(options->out_prefix, "language-gate") != NULL ||
        strstr(options->events_path, "language-gate") != NULL)
        fail("Q3.0 pilot outputs cannot target evaluation paths");
}

static void q30_path(char *path, size_t capacity, const char *prefix,
                     int update)
{
    int written = snprintf(path, capacity, "%s-u%06d.q30", prefix, update);
    if (written < 0 || (size_t)written >= capacity)
        fail("Q3.0 checkpoint path is too long");
}

static void q30_require_absent(const char *path)
{
    FILE *file;
    errno = 0;
    file = fopen(path, "rb");
    if (file != NULL) {
        fclose(file);
        fail_path("refuse to overwrite Q3.0 output", path);
    }
    if (errno != ENOENT) fail_path("inspect Q3.0 output", path);
}

static float q30_forward(Model *model, Q30Adapter *adapter,
                         const Token *tokens, const Token *targets,
                         const unsigned char *mask, int quantity)
{
    float **w1;
    float **w2;
    float loss;
    if (!quantity)
        return model_forward_masked(model, tokens, targets, 0.0f, NULL, mask);
    w1 = zero_alloc((size_t)model->cfg.layers, sizeof(*w1));
    w2 = zero_alloc((size_t)model->cfg.layers, sizeof(*w2));
    q30_adapter_activate(adapter, model, w1, w2);
    loss = model_forward_masked(model, tokens, targets, 0.0f, NULL, mask);
    q30_adapter_deactivate(model, w1, w2);
    free(w1); free(w2);
    return loss;
}

static void q30_train_sample(Model *model, Q30Adapter *adapter,
                             const Corpus *corpus,
                             const CorpusRange *quantity,
                             unsigned char *mask, Rng *rng)
{
    float **w1 = zero_alloc((size_t)model->cfg.layers, sizeof(*w1));
    float **w2 = zero_alloc((size_t)model->cfg.layers, sizeof(*w2));
    size_t record = (size_t)(rng_next(rng) % quantity->training_record_count);
    size_t start = quantity->record_starts[record];
    model_zero_grad(model);
    memset(mask, 0, (size_t)model->cfg.context);
    if (channel_loss_mask(corpus->data + start, corpus->data + start + 1,
                          mask, model->cfg.context, 1) == 0)
        fail("Q3.0 quantity sample has no reply target");
    q30_adapter_activate(adapter, model, w1, w2);
    (void)model_forward_masked(model, corpus->data + start,
                               corpus->data + start + 1, 0.0f, NULL, mask);
    model_backward_masked(model, corpus->data + start,
                          corpus->data + start + 1, mask);
    q30_adapter_deactivate(model, w1, w2);
    q30_adapter_accumulate_gradient(adapter, model, 1.0f / Q30_BATCH);
    free(w1); free(w2);
}

static double q30_sample_loss(Model *model, Q30Adapter *adapter,
                              const Corpus *corpus,
                              const CorpusRange *range, unsigned char *mask,
                              int sample, int samples, int quantity)
{
    size_t start;
    if (range->channel) {
        size_t record = samples == 1 ? 0 : (size_t)sample *
            (range->training_record_count - 1) / (size_t)(samples - 1);
        start = range->record_starts[record];
        memset(mask, 0, (size_t)model->cfg.context);
        if (channel_loss_mask(corpus->data + start, corpus->data + start + 1,
                              mask, model->cfg.context, 1) == 0)
            fail("Q3.0 measurement sample has no target");
        return q30_forward(model, adapter, corpus->data + start,
                           corpus->data + start + 1, mask, quantity);
    }
    {
        size_t choices = range->training_length - model->cfg.context;
        size_t local = samples == 1 ? 0 : (size_t)sample * (choices - 1) /
            (size_t)(samples - 1);
        start = range->start + local;
    }
    return q30_forward(model, adapter, corpus->data + start,
                       corpus->data + start + 1, NULL, quantity);
}

static Q30Measurement q30_measure(Model *model, Q30Adapter *adapter,
                                  const Corpus *corpus,
                                  const CorpusRange ranges[7],
                                  unsigned char *mask)
{
    Q30Measurement result = {0.0, 0.0};
    int range;
    int sample;
    for (sample = 0; sample < Q30_MEASURE_SAMPLES; ++sample)
        result.quantity_loss += q30_sample_loss(
            model, adapter, corpus, &ranges[6], mask, sample,
            Q30_MEASURE_SAMPLES, 1) / Q30_MEASURE_SAMPLES;
    for (range = 0; range < 6; ++range)
        for (sample = 0; sample < Q30_MEASURE_SAMPLES; ++sample)
            result.replay_loss += q30_sample_loss(
                model, adapter, corpus, &ranges[range], mask, sample,
                Q30_MEASURE_SAMPLES, 0) / (6 * Q30_MEASURE_SAMPLES);
    if (!isfinite(result.quantity_loss) || !isfinite(result.replay_loss))
        fail("Q3.0 measurement produced non-finite loss");
    return result;
}

static void q30_run(Model *model, Q30Adapter *adapter, const Corpus *corpus,
                    const CorpusRange ranges[7], Rng *rng,
                    const Q30Options *options)
{
    unsigned char *mask = zero_alloc((size_t)model->cfg.context, 1);
    uint64_t base_digest = model_learned_state_digest(model);
    Q30Measurement baseline;
    FILE *events;
    char checkpoint[4096];
    const char *stop_reason = "update-cap";
    int updates_committed = 0;
    int update;
    for (update = 0; update <= Q30_MAXIMUM_UPDATES;
         update += Q30_MEASUREMENT_CADENCE) {
        q30_path(checkpoint, sizeof(checkpoint), options->out_prefix, update);
        q30_require_absent(checkpoint);
    }
    q30_require_absent(options->events_path);
    events = fopen(options->events_path, "w");
    if (events == NULL) fail_path("open Q3.0 events", options->events_path);
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"start\","
            "\"seed\":%d,\"rank\":%d,\"base_parameters\":%zu,"
            "\"trainable_parameters\":%zu,\"maximum_updates\":%d,"
            "\"measurement_updates\":[0,50,100,150,200],"
            "\"authorization_sha256\":\"%s\","
            "\"base_state_digest\":\"%016llx\"}\n",
            Q30_SCHEMA, Q30_SEED, Q30_RANK, model_parameter_total(model),
            q30_adapter_parameter_total(adapter), Q30_MAXIMUM_UPDATES,
            options->authorization_sha256,
            (unsigned long long)base_digest);
    q30_path(checkpoint, sizeof(checkpoint), options->out_prefix, 0);
    q30_checkpoint_save(checkpoint, model, adapter, 0, base_digest);
    baseline = q30_measure(model, adapter, corpus, ranges, mask);
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"measurement\","
            "\"update\":0,\"quantity_training_loss\":%.17g,"
            "\"replay_training_loss\":%.17g}\n",
            Q30_SCHEMA, baseline.quantity_loss, baseline.replay_loss);
    for (update = 1; update <= Q30_MAXIMUM_UPDATES; ++update) {
        int sample;
        q30_adapter_zero_grad(adapter);
        for (sample = 0; sample < Q30_BATCH; ++sample)
            q30_train_sample(model, adapter, corpus, &ranges[6], mask, rng);
        q30_adapter_update(adapter, (uint64_t)update);
        updates_committed = update;
        if (model_learned_state_digest(model) != base_digest)
            fail("Q3.0 changed frozen ZERO.3 state");
        if (update % Q30_MEASUREMENT_CADENCE == 0) {
            Q30Measurement measurement = q30_measure(model, adapter, corpus,
                                                     ranges, mask);
            double improvement =
                (baseline.quantity_loss - measurement.quantity_loss) /
                baseline.quantity_loss;
            if (memcmp(&measurement.replay_loss, &baseline.replay_loss,
                       sizeof(double)) != 0)
                fail("Q3.0 non-Q replay path is not bit-identical");
            q30_path(checkpoint, sizeof(checkpoint), options->out_prefix,
                     update);
            q30_checkpoint_save(checkpoint, model, adapter, (uint64_t)update,
                                base_digest);
            fprintf(events,
                    "{\"schema\":\"%s\",\"type\":\"measurement\","
                    "\"update\":%d,\"quantity_training_loss\":%.17g,"
                    "\"quantity_improvement\":%.17g,"
                    "\"replay_training_loss\":%.17g,"
                    "\"base_state_digest\":\"%016llx\","
                    "\"adapter_state_digest\":\"%016llx\"}\n",
                    Q30_SCHEMA, update, measurement.quantity_loss,
                    improvement, measurement.replay_loss,
                    (unsigned long long)base_digest,
                    (unsigned long long)q30_adapter_digest(adapter));
            fflush(events);
            if (improvement >= Q30_QUANTITY_IMPROVEMENT_MINIMUM) {
                stop_reason = "quantity-first-hit";
                break;
            }
        }
    }
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"complete\","
            "\"updates_committed\":%d,\"stop_reason\":\"%s\","
            "\"candidate_checkpoint_available\":%s,"
            "\"language_gate_run\":false,\"promotion_run\":false}\n",
            Q30_SCHEMA, updates_committed, stop_reason,
            strcmp(stop_reason, "quantity-first-hit") == 0 ? "true" :
                                                               "false");
    if (fclose(events) != 0) fail_path("close Q3.0 events",
                                      options->events_path);
    free(mask);
}

static int q30_self_test(const char *artifact_prefix)
{
    Config cfg = {4, 8, 2, 1, 16, 1, DEFAULT_VOCAB_SIZE};
    Token q[4] = {CHANNEL_START_TOKEN, 'Q', 'a', 'b'};
    Token targets[4] = {'Q', 'a', 'b', 'c'};
    Rng rng;
    Model model;
    Q30Adapter adapter = {0};
    uint64_t base_digest;
    uint64_t adapter_digest;
    unsigned char mask[4] = {0, 1, 1, 1};
    char path[4096];
    (void)q28_run_audit;
    rng_seed(&rng, 30);
    model_create(&model, cfg, &rng);
    base_digest = model_learned_state_digest(&model);
    if (artifact_prefix != NULL) {
        snprintf(path, sizeof(path), "%s-base.ckpt", artifact_prefix);
        q30_require_absent(path);
        checkpoint_save(path, &model, 0, &rng, 0, 0, 0);
    }
    q30_adapter_create(&adapter, &model, &rng);
    if (q30_adapter_parameter_total(&adapter) != 192 ||
        model_learned_state_digest(&model) != base_digest)
        fail("Q3.0 parameter-isolation self-test failed");
    if (artifact_prefix != NULL) {
        snprintf(path, sizeof(path), "%s-adapter0.q30", artifact_prefix);
        q30_require_absent(path);
        q30_checkpoint_save(path, &model, &adapter, 0, base_digest);
    }
    adapter_digest = q30_adapter_digest(&adapter);
    q30_adapter_zero_grad(&adapter);
    {
        float **w1 = zero_alloc(1, sizeof(*w1));
        float **w2 = zero_alloc(1, sizeof(*w2));
        q30_adapter_activate(&adapter, &model, w1, w2);
        (void)model_forward_masked(&model, q, targets, 0.0f, NULL, mask);
        model_backward_masked(&model, q, targets, mask);
        q30_adapter_deactivate(&model, w1, w2);
        free(w1); free(w2);
    }
    q30_adapter_accumulate_gradient(&adapter, &model, 1.0f);
    q30_adapter_update(&adapter, 1);
    if (q30_adapter_digest(&adapter) == adapter_digest ||
        model_learned_state_digest(&model) != base_digest)
        fail("Q3.0 isolated optimizer self-test failed");
    if (artifact_prefix != NULL) {
        snprintf(path, sizeof(path), "%s-adapter.q30", artifact_prefix);
        q30_require_absent(path);
        q30_checkpoint_save(path, &model, &adapter, 1, base_digest);
    }
    q30_adapter_destroy(&adapter);
    model_destroy(&model);
    puts("Q3.0 routed low-rank adapter mechanics self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    Q30Options options = {0};
    Q28AuditOptions corpus_options = {0};
    Config cfg = preset_config("literary");
    Rng initialization_rng;
    Rng adapter_rng;
    Rng sample_rng;
    Model model;
    Q30Adapter adapter = {0};
    Tokenizer tokenizer = {0};
    Corpus corpus = {0};
    CorpusRange ranges[7];
    int index;
    if ((argc == 2 && strcmp(argv[1], "--self-test") == 0) ||
        (argc == 3 && strcmp(argv[1], "--self-test-artifacts") == 0)) {
        const char *prefix = argc == 3 ? argv[2] : NULL;
        return run_self_test() && q28_self_test() && q30_self_test(prefix)
                   ? 0 : 1;
    }
    for (index = 1; index < argc; ++index) {
        if (index + 1 >= argc) fail("incomplete Q3.0 option");
        if (strcmp(argv[index], "--out-prefix") == 0)
            options.out_prefix = argv[++index];
        else if (strcmp(argv[index], "--events") == 0)
            options.events_path = argv[++index];
        else if (strcmp(argv[index], "--authorization-sha256") == 0)
            options.authorization_sha256 = argv[++index];
        else fail("unknown Q3.0 option");
    }
    q30_validate_options(&options);
    tokenizer_load(&tokenizer, "corpus/literary.bpe");
    rng_seed(&initialization_rng, 0);
    model_create(&model, cfg, &initialization_rng);
    model_set_trainable_scope(&model, TRAINABLE_SCOPE_ALL);
    (void)artifact_load_weights(Q30_INIT, &model);
    for (index = 0; index < model.parameter_count; ++index)
        model.parameters[index]->trainable = 0;
    rng_seed(&adapter_rng, Q30_SEED);
    q30_adapter_create(&adapter, &model, &adapter_rng);
    corpus_options.quantity_path = Q30_QUANTITY;
    q28_load_corpus(&corpus, ranges, &corpus_options, &model, &tokenizer);
    rng_seed(&sample_rng, Q30_SEED);
    q30_run(&model, &adapter, &corpus, ranges, &sample_rng, &options);
    q28_destroy_ranges(ranges);
    corpus_destroy(&corpus);
    q30_adapter_destroy(&adapter);
    model_destroy(&model);
    return 0;
}
