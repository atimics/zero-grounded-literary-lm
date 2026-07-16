#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * zero_lm.c
 *
 * A tiny autoregressive neural language model written in ISO C.  The program
 * begins with zero-filled storage, then introduces distinctions through
 * indices, deterministic initialization, data, and learning.
 *
 * This is a finite machine model, not an implementation of ZFC itself:
 *   natural-number indices       -> array positions
 *   finite functions/tensors     -> flat arrays
 *   finite token sequences       -> integer arrays
 *   real-number approximations   -> float
 *   function composition         -> forward()
 */

enum {
    CONTEXT = 16,
    EMBED = 12,
    HIDDEN = 32
};

static const char TRAINING_TEXT[] =
    "zero is the empty beginning.\n"
    "one is the successor of zero.\n"
    "two contains zero and one.\n"
    "number grows by preserving what came before.\n"
    "a token is a finite symbol.\n"
    "a sequence is an ordered list of tokens.\n"
    "a vector is a finite function into numbers.\n"
    "a matrix transforms one vector into another.\n"
    "a layer composes a matrix with a nonlinearity.\n"
    "a network is a composition of layers.\n"
    "a language model predicts the next token.\n"
    "training changes parameters to reduce surprise.\n"
    "structure is grounded in zero but is not equal to zero.\n"
    "difference is preserved by relation and position.\n"
    "meaning appears in patterns across many distinctions.\n";

typedef struct {
    uint64_t state;
} Rng;

typedef struct {
    int vocab;
    int input;

    float *embedding; /* vocab x EMBED */
    float *w1;        /* HIDDEN x input */
    float *b1;        /* HIDDEN */
    float *w2;        /* vocab x HIDDEN */
    float *b2;        /* vocab */

    /* Reused work space.  Every allocation is initially all zero. */
    float *x;
    float *h;
    float *probs;
    float *dlogits;
    float *dh;
    float *da;
    float *dx;
} Model;

typedef struct {
    int char_to_token[256];
    unsigned char token_to_char[256];
    int size;
} Vocabulary;

static void die(const char *message)
{
    fprintf(stderr, "error: %s\n", message);
    exit(EXIT_FAILURE);
}

static void *zero_alloc(size_t count, size_t size)
{
    void *memory = calloc(count, size);
    if (memory == NULL) {
        die("could not allocate memory");
    }
    return memory;
}

/* Seed 0 is mapped through a successor-like +1 before mixing. */
static void rng_seed(Rng *rng, uint64_t seed)
{
    uint64_t z = seed + UINT64_C(1);
    z += UINT64_C(0x9e3779b97f4a7c15);
    z = (z ^ (z >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)) * UINT64_C(0x94d049bb133111eb);
    rng->state = z ^ (z >> 31);
    if (rng->state == 0) {
        rng->state = 1;
    }
}

static uint64_t rng_next(Rng *rng)
{
    uint64_t x = rng->state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    rng->state = x;
    return x * UINT64_C(0x2545f4914f6cdd1d);
}

static float rng_unit(Rng *rng)
{
    return (float)((rng_next(rng) >> 40) * (1.0 / 16777216.0));
}

static float rng_symmetric(Rng *rng, float scale)
{
    return (2.0f * rng_unit(rng) - 1.0f) * scale;
}

static void vocabulary_build(Vocabulary *vocab, const char *text)
{
    int present[256] = {0};
    const unsigned char *cursor = (const unsigned char *)text;
    int i;

    for (i = 0; i < 256; ++i) {
        vocab->char_to_token[i] = -1;
    }
    while (*cursor != '\0') {
        present[*cursor] = 1;
        ++cursor;
    }
    for (i = 0; i < 256; ++i) {
        if (present[i]) {
            vocab->char_to_token[i] = vocab->size;
            vocab->token_to_char[vocab->size] = (unsigned char)i;
            ++vocab->size;
        }
    }
}

static int *encode_text(const Vocabulary *vocab, const char *text, size_t *length)
{
    size_t i;
    int *tokens;

    *length = strlen(text);
    tokens = zero_alloc(*length, sizeof(*tokens));
    for (i = 0; i < *length; ++i) {
        int token = vocab->char_to_token[(unsigned char)text[i]];
        if (token < 0) {
            die("training text contains an unknown byte");
        }
        tokens[i] = token;
    }
    return tokens;
}

static Model model_create(int vocab, Rng *rng)
{
    Model model = {0};
    size_t i;
    size_t embedding_count;
    size_t w1_count;
    size_t w2_count;
    float w1_scale;
    float w2_scale;

    model.vocab = vocab;
    model.input = CONTEXT * EMBED;
    embedding_count = (size_t)vocab * EMBED;
    w1_count = (size_t)HIDDEN * (size_t)model.input;
    w2_count = (size_t)vocab * HIDDEN;

    model.embedding = zero_alloc(embedding_count, sizeof(float));
    model.w1 = zero_alloc(w1_count, sizeof(float));
    model.b1 = zero_alloc(HIDDEN, sizeof(float));
    model.w2 = zero_alloc(w2_count, sizeof(float));
    model.b2 = zero_alloc((size_t)vocab, sizeof(float));
    model.x = zero_alloc((size_t)model.input, sizeof(float));
    model.h = zero_alloc(HIDDEN, sizeof(float));
    model.probs = zero_alloc((size_t)vocab, sizeof(float));
    model.dlogits = zero_alloc((size_t)vocab, sizeof(float));
    model.dh = zero_alloc(HIDDEN, sizeof(float));
    model.da = zero_alloc(HIDDEN, sizeof(float));
    model.dx = zero_alloc((size_t)model.input, sizeof(float));

    /* Distinguish otherwise symmetric neurons after zero allocation. */
    for (i = 0; i < embedding_count; ++i) {
        model.embedding[i] = rng_symmetric(rng, 0.12f);
    }
    w1_scale = sqrtf(6.0f / (model.input + HIDDEN));
    w2_scale = sqrtf(6.0f / (HIDDEN + vocab));
    for (i = 0; i < w1_count; ++i) {
        model.w1[i] = rng_symmetric(rng, w1_scale);
    }
    for (i = 0; i < w2_count; ++i) {
        model.w2[i] = rng_symmetric(rng, w2_scale);
    }
    return model;
}

static void model_destroy(Model *model)
{
    free(model->embedding);
    free(model->w1);
    free(model->b1);
    free(model->w2);
    free(model->b2);
    free(model->x);
    free(model->h);
    free(model->probs);
    free(model->dlogits);
    free(model->dh);
    free(model->da);
    free(model->dx);
    memset(model, 0, sizeof(*model));
}

static void forward(Model *model, const int context[CONTEXT])
{
    int position;
    int i;
    int j;
    int v;
    float maximum;
    float total = 0.0f;

    for (position = 0; position < CONTEXT; ++position) {
        int token = context[position];
        for (j = 0; j < EMBED; ++j) {
            model->x[position * EMBED + j] =
                model->embedding[token * EMBED + j];
        }
    }

    for (j = 0; j < HIDDEN; ++j) {
        float activation = model->b1[j];
        const float *weights = &model->w1[j * model->input];
        for (i = 0; i < model->input; ++i) {
            activation += weights[i] * model->x[i];
        }
        model->h[j] = tanhf(activation);
    }

    for (v = 0; v < model->vocab; ++v) {
        float logit = model->b2[v];
        const float *weights = &model->w2[v * HIDDEN];
        for (j = 0; j < HIDDEN; ++j) {
            logit += weights[j] * model->h[j];
        }
        model->probs[v] = logit;
    }

    maximum = model->probs[0];
    for (v = 1; v < model->vocab; ++v) {
        if (model->probs[v] > maximum) {
            maximum = model->probs[v];
        }
    }
    for (v = 0; v < model->vocab; ++v) {
        model->probs[v] = expf(model->probs[v] - maximum);
        total += model->probs[v];
    }
    for (v = 0; v < model->vocab; ++v) {
        model->probs[v] /= total;
    }
}

static float clip(float value)
{
    const float limit = 5.0f;
    if (value > limit) {
        return limit;
    }
    if (value < -limit) {
        return -limit;
    }
    return value;
}

static float train_step(Model *model, const int context[CONTEXT], int target,
                        float learning_rate)
{
    int i;
    int j;
    int v;
    int position;
    float target_probability;

    forward(model, context);
    target_probability = model->probs[target];
    if (target_probability < 1.0e-12f) {
        target_probability = 1.0e-12f;
    }

    for (v = 0; v < model->vocab; ++v) {
        model->dlogits[v] = model->probs[v] - (v == target ? 1.0f : 0.0f);
    }

    /* Compute all upstream gradients before modifying any weights. */
    for (j = 0; j < HIDDEN; ++j) {
        float gradient = 0.0f;
        for (v = 0; v < model->vocab; ++v) {
            gradient += model->w2[v * HIDDEN + j] * model->dlogits[v];
        }
        model->dh[j] = gradient;
        model->da[j] = gradient * (1.0f - model->h[j] * model->h[j]);
    }
    for (i = 0; i < model->input; ++i) {
        float gradient = 0.0f;
        for (j = 0; j < HIDDEN; ++j) {
            gradient += model->w1[j * model->input + i] * model->da[j];
        }
        model->dx[i] = gradient;
    }

    for (v = 0; v < model->vocab; ++v) {
        float gradient = clip(model->dlogits[v]);
        for (j = 0; j < HIDDEN; ++j) {
            model->w2[v * HIDDEN + j] -=
                learning_rate * clip(gradient * model->h[j]);
        }
        model->b2[v] -= learning_rate * gradient;
    }
    for (j = 0; j < HIDDEN; ++j) {
        float gradient = clip(model->da[j]);
        for (i = 0; i < model->input; ++i) {
            model->w1[j * model->input + i] -=
                learning_rate * clip(gradient * model->x[i]);
        }
        model->b1[j] -= learning_rate * gradient;
    }
    for (position = 0; position < CONTEXT; ++position) {
        int token = context[position];
        for (j = 0; j < EMBED; ++j) {
            int input_index = position * EMBED + j;
            model->embedding[token * EMBED + j] -=
                learning_rate * clip(model->dx[input_index]);
        }
    }

    return -logf(target_probability);
}

static void context_for_position(int context[CONTEXT], const int *tokens,
                                 size_t position, int padding)
{
    int slot;
    for (slot = 0; slot < CONTEXT; ++slot) {
        long source = (long)position - CONTEXT + slot;
        context[slot] = source >= 0 ? tokens[source] : padding;
    }
}

static int sample_token(Model *model, float temperature, Rng *rng)
{
    int v;
    int best = 0;
    float total = 0.0f;
    float threshold;

    if (temperature <= 0.0f) {
        for (v = 1; v < model->vocab; ++v) {
            if (model->probs[v] > model->probs[best]) {
                best = v;
            }
        }
        return best;
    }

    for (v = 0; v < model->vocab; ++v) {
        model->dlogits[v] = powf(model->probs[v], 1.0f / temperature);
        total += model->dlogits[v];
    }
    threshold = rng_unit(rng) * total;
    for (v = 0; v < model->vocab; ++v) {
        threshold -= model->dlogits[v];
        if (threshold <= 0.0f) {
            return v;
        }
    }
    return model->vocab - 1;
}

static long parse_long(const char *text, const char *option)
{
    char *end = NULL;
    long value;
    errno = 0;
    value = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0') {
        fprintf(stderr, "error: invalid value for %s: %s\n", option, text);
        exit(EXIT_FAILURE);
    }
    return value;
}

static float parse_float(const char *text, const char *option)
{
    char *end = NULL;
    float value;
    errno = 0;
    value = strtof(text, &end);
    if (errno != 0 || end == text || *end != '\0') {
        fprintf(stderr, "error: invalid value for %s: %s\n", option, text);
        exit(EXIT_FAILURE);
    }
    return value;
}

static void usage(const char *program)
{
    printf("usage: %s [options]\n", program);
    printf("  --steps N          training updates (default: 20000)\n");
    printf("  --prompt TEXT      generation prefix (default: zero)\n");
    printf("  --tokens N         tokens to generate (default: 160)\n");
    printf("  --temperature X    0 for greedy, higher for variety (default: 0.35)\n");
    printf("  --seed N           deterministic seed (default: 0)\n");
    printf("  --help             show this message\n");
}

int main(int argc, char **argv)
{
    long steps = 20000;
    long generated_tokens = 160;
    long seed_value = 0;
    const char *prompt = "zero";
    float temperature = 0.35f;
    float learning_rate = 0.025f;
    Vocabulary vocab = {{0}, {0}, 0};
    Rng rng;
    Model model;
    int *training_tokens;
    size_t training_length;
    int padding;
    int context[CONTEXT];
    long step;
    long report_every;
    float running_loss = 0.0f;
    int i;

    for (i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--help") == 0) {
            usage(argv[0]);
            return EXIT_SUCCESS;
        } else if (strcmp(argv[i], "--steps") == 0 && i + 1 < argc) {
            steps = parse_long(argv[++i], "--steps");
        } else if (strcmp(argv[i], "--prompt") == 0 && i + 1 < argc) {
            prompt = argv[++i];
        } else if (strcmp(argv[i], "--tokens") == 0 && i + 1 < argc) {
            generated_tokens = parse_long(argv[++i], "--tokens");
        } else if (strcmp(argv[i], "--temperature") == 0 && i + 1 < argc) {
            temperature = parse_float(argv[++i], "--temperature");
        } else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            seed_value = parse_long(argv[++i], "--seed");
        } else {
            fprintf(stderr, "error: unknown or incomplete option: %s\n", argv[i]);
            usage(argv[0]);
            return EXIT_FAILURE;
        }
    }
    if (steps < 0 || generated_tokens < 0 || temperature < 0.0f) {
        die("steps, tokens, and temperature must be nonnegative");
    }

    vocabulary_build(&vocab, TRAINING_TEXT);
    training_tokens = encode_text(&vocab, TRAINING_TEXT, &training_length);
    padding = vocab.char_to_token[(unsigned char)' '];
    if (padding < 0 || training_length < 2) {
        die("training corpus is too small or has no space token");
    }

    rng_seed(&rng, (uint64_t)seed_value);
    model = model_create(vocab.size, &rng);
    report_every = steps >= 10 ? steps / 10 : (steps > 0 ? steps : 1);

    printf("zero_lm: vocab=%d context=%d embed=%d hidden=%d parameters=%zu\n",
           vocab.size, CONTEXT, EMBED, HIDDEN,
           (size_t)vocab.size * EMBED + (size_t)HIDDEN * model.input + HIDDEN +
               (size_t)vocab.size * HIDDEN + (size_t)vocab.size);
    for (step = 1; step <= steps; ++step) {
        size_t position = 1 + (size_t)(rng_next(&rng) % (training_length - 1));
        context_for_position(context, training_tokens, position, padding);
        running_loss += train_step(&model, context, training_tokens[position],
                                   learning_rate);
        if (step % report_every == 0 || step == steps) {
            long window = step % report_every == 0 ? report_every : step % report_every;
            printf("step %6ld  mean loss %.4f\n", step, running_loss / window);
            running_loss = 0.0f;
        }
    }

    for (i = 0; i < CONTEXT; ++i) {
        context[i] = padding;
    }
    for (i = 0; prompt[i] != '\0'; ++i) {
        int token = vocab.char_to_token[(unsigned char)prompt[i]];
        if (token < 0) {
            fprintf(stderr,
                    "error: prompt byte 0x%02x was not present in the training text\n",
                    (unsigned char)prompt[i]);
            free(training_tokens);
            model_destroy(&model);
            return EXIT_FAILURE;
        }
        memmove(context, context + 1, (CONTEXT - 1) * sizeof(context[0]));
        context[CONTEXT - 1] = token;
    }

    printf("\n--- generated ---\n%s", prompt);
    for (step = 0; step < generated_tokens; ++step) {
        int token;
        forward(&model, context);
        token = sample_token(&model, temperature, &rng);
        putchar(vocab.token_to_char[token]);
        memmove(context, context + 1, (CONTEXT - 1) * sizeof(context[0]));
        context[CONTEXT - 1] = token;
    }
    putchar('\n');

    free(training_tokens);
    model_destroy(&model);
    return EXIT_SUCCESS;
}
