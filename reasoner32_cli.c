#include "reasoner32.h"

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s build MODEL.r32p\n"
            "  %s compress DENSE.r31p MODEL.r32p\n"
            "  %s verify DENSE.r31p MODEL.r32p\n"
            "  %s render MODEL.r32p PROGRAM_INDEX\n"
            "  %s demo\n"
            "  %s --self-test\n",
            program, program, program, program, program, program);
}

static int parse_u16(const char *text, uint16_t maximum, uint16_t *value)
{
    char *end;
    unsigned long parsed;
    errno = 0;
    parsed = strtoul(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || parsed > maximum)
        return 0;
    *value = (uint16_t)parsed;
    return 1;
}

static void print_compression(const R32CompressionReport *report,
                              const char *path)
{
    printf("{\"schema\":\"zero.reasoner32_compression.v1\","
           "\"version\":\"(3,2)\",\"language_targets\":0,"
           "\"dense_artifact_bytes\":%u,"
           "\"sparse_artifact_bytes\":%u,"
           "\"active_weight_bytes\":%u,"
           "\"dense_weight_slots\":%u,"
           "\"source_nonzero_weights\":%u,"
           "\"retained_weights\":%u,\"pruned_weights\":%u,"
           "\"source_zero_weights\":%u,"
           "\"distinct_retained_values\":%u,"
           "\"minimum_retained_weight\":%d,"
           "\"maximum_retained_weight\":%d,"
           "\"compression_milli\":%u,"
           "\"world_pairs\":%u,\"accepted_pairs\":%u,"
           "\"rejected_pairs\":%u,\"actionable_pairs\":%u,"
           "\"actionless_pairs\":%u,"
           "\"canonical_contexts\":%u,"
           "\"action_mismatches\":%u,"
           "\"trace_programs\":%u,\"trace_steps\":%u,"
           "\"trace_mismatches\":%u,\"seal_mismatches\":%u,"
           "\"behavior_digest\":\"%016" PRIx64 "\","
           "\"trace_digest\":\"%016" PRIx64 "\","
           "\"exact\":%s,\"model\":\"%s\"}\n",
           report->dense_artifact_bytes,
           report->sparse_artifact_bytes,
           report->runtime_weight_bytes, report->dense_weight_count,
           report->source_nonzero_weights, report->retained_weights,
           report->pruned_weights, report->zero_weights,
           report->distinct_nonzero_values, report->minimum_weight,
           report->maximum_weight, report->compression_milli,
           report->world_pairs, report->accepted_pairs,
           report->rejected_pairs, report->actionable_pairs,
           report->actionless_pairs, report->canonical_contexts,
           report->action_mismatches, report->trace_programs,
           report->trace_steps, report->trace_mismatches,
           report->seal_mismatches, report->sparse_behavior_digest,
           report->sparse_trace_digest,
           report->exact ? "true" : "false", path == NULL ? "" : path);
}

static void print_equivalence(const R32CompressionReport *report)
{
    printf("{\"schema\":\"zero.reasoner32_equivalence.v1\","
           "\"version\":\"(3,2)\",\"world_pairs\":%u,"
           "\"accepted_pairs\":%u,\"rejected_pairs\":%u,"
           "\"actionable_pairs\":%u,\"actionless_pairs\":%u,"
           "\"action_mismatches\":%u,"
           "\"trace_programs\":%u,\"trace_steps\":%u,"
           "\"trace_mismatches\":%u,\"seal_mismatches\":%u,"
           "\"dense_behavior_digest\":\"%016" PRIx64 "\","
           "\"sparse_behavior_digest\":\"%016" PRIx64 "\","
           "\"dense_trace_digest\":\"%016" PRIx64 "\","
           "\"sparse_trace_digest\":\"%016" PRIx64 "\","
           "\"exact\":%s}\n",
           report->world_pairs, report->accepted_pairs,
           report->rejected_pairs, report->actionable_pairs,
           report->actionless_pairs, report->action_mismatches,
           report->trace_programs, report->trace_steps,
           report->trace_mismatches, report->seal_mismatches,
           report->dense_behavior_digest,
           report->sparse_behavior_digest, report->dense_trace_digest,
           report->sparse_trace_digest,
           report->exact ? "true" : "false");
}

static int check(int condition, const char *message)
{
    if (!condition) fprintf(stderr, "self-test failed: %s\n", message);
    return condition;
}

static long file_size(const char *path)
{
    FILE *file = fopen(path, "rb");
    long size;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0) {
        if (file != NULL) (void)fclose(file);
        return -1;
    }
    size = ftell(file);
    if (fclose(file) != 0) return -1;
    return size;
}

static int corrupt_copy(const char *source, const char *destination)
{
    uint8_t bytes[R32_MAX_ARTIFACT_BYTES];
    FILE *file = fopen(source, "rb");
    size_t size;
    int failed;
    if (file == NULL) return 0;
    size = fread(bytes, 1, sizeof(bytes), file);
    failed = ferror(file);
    if (fclose(file) != 0) failed = 1;
    if (failed || size <= R32_ARTIFACT_HEADER_BYTES)
        return 0;
    bytes[size - 1] ^= UINT8_C(1);
    file = fopen(destination, "wb");
    if (file == NULL) return 0;
    failed = fwrite(bytes, size, 1, file) != 1;
    if (fclose(file) != 0) failed = 1;
    return !failed;
}

static int same_sparse_model(const R32Model *left, const R32Model *right)
{
    return left->count == right->count &&
           left->trained_stage == right->trained_stage &&
           left->evaluated_stage == right->evaluated_stage &&
           left->sealed_test_passed == right->sealed_test_passed &&
           left->behavior_digest == right->behavior_digest &&
           left->trace_digest == right->trace_digest &&
           memcmp(left->indices, right->indices,
                  left->count * sizeof(left->indices[0])) == 0 &&
           memcmp(left->values, right->values,
                  left->count * sizeof(left->values[0])) == 0;
}

static int self_test(void)
{
    R31Model dense;
    R31TrainingReport training;
    R32Model sparse, repeated, loaded, corrupted;
    R32CompressionReport report, repeated_report, replay;
    R31Invariant invariant;
    R31AnswerIR answer;
    uint32_t calls;
    uint16_t program, test_program = UINT16_MAX;
    char path[160], corrupt_path[160], output[256], error[256] = {0};
    R0Status status = r31_train(&dense, &training, error, sizeof(error));

    if (!check(status == R0_OK && training.experiment_passed,
               error[0] == '\0' ? "the frozen (3,1) policy trains" : error))
        return 0;
    status = r32_compress(&dense, &sparse, &report, error, sizeof(error));
    if (!check(status == R0_OK && report.exact,
               error[0] == '\0' ? "exact compression succeeds" : error) ||
        !check(report.dense_artifact_bytes == 524316 &&
                   report.sparse_artifact_bytes == 87 &&
                   report.runtime_weight_bytes == 80 &&
                   report.dense_weight_count == 131072 &&
                   report.source_nonzero_weights == 186 &&
                   report.retained_weights == 16 &&
                   report.pruned_weights == 170 &&
                   report.zero_weights == 130886 &&
                   report.distinct_nonzero_values == 7 &&
                   report.minimum_weight == -3 &&
                   report.maximum_weight == 4 &&
                   report.compression_milli == 999,
               "the sparse size and weight census is frozen") ||
        !check(report.world_pairs == 2093056 &&
                   report.accepted_pairs == 1727 &&
                   report.rejected_pairs == 2091329 &&
                   report.actionable_pairs == 657601 &&
                   report.actionless_pairs == 1433728 &&
                   report.canonical_contexts == 61397 &&
                   report.action_mismatches == 0,
               "every program and hypothesis has the same action") ||
        !check(report.trace_programs == 511 &&
                   report.trace_steps == 1920 &&
                   report.trace_mismatches == 0 &&
                   report.seal_mismatches == 0 &&
                   report.sparse_behavior_digest ==
                       R32_REFERENCE_BEHAVIOR_DIGEST &&
                   report.sparse_trace_digest ==
                       R32_REFERENCE_TRACE_DIGEST,
               "every complete sparse trace and seal is frozen"))
        return 0;
    status = r32_compress(&dense, &repeated, &repeated_report, error,
                          sizeof(error));
    if (!check(status == R0_OK && repeated_report.exact &&
                   same_sparse_model(&sparse, &repeated),
               "behavioral pruning is deterministic"))
        return 0;
    for (program = 0; program < r31_program_count(); ++program)
        if (r31_program_stage(program) == R31_TEST_STAGE) {
            test_program = program;
            break;
        }
    status = r32_solve(&sparse, test_program, &invariant, &calls, error,
                       sizeof(error));
    if (status == R0_OK)
        status = r31_answer_seal(test_program, &invariant, &answer, error,
                                 sizeof(error));
    if (status == R0_OK)
        status = r31_language_render(&answer, output, sizeof(output), error,
                                     sizeof(error));
    if (!check(status == R0_OK && calls <= R31_MAX_REPAIR_STEPS &&
                   strstr(output, "The verified invariant is ") == output,
               "language remains a post-seal tool"))
        return 0;
    (void)snprintf(path, sizeof(path),
                   "/tmp/reasoner32-self-test-%ld.r32p", (long)getpid());
    (void)snprintf(corrupt_path, sizeof(corrupt_path),
                   "/tmp/reasoner32-self-test-%ld-corrupt.r32p",
                   (long)getpid());
    (void)remove(path);
    (void)remove(corrupt_path);
    status = r32_model_save(&sparse, path, error, sizeof(error));
    if (status == R0_OK)
        status = r32_model_load(&loaded, path, error, sizeof(error));
    if (status == R0_OK)
        status = r32_verify_equivalence(&dense, &loaded, &replay, error,
                                        sizeof(error));
    if (!check(status == R0_OK && file_size(path) == 87 && replay.exact &&
                   same_sparse_model(&sparse, &loaded),
               "the 87-byte artifact passes exhaustive round-trip replay")) {
        (void)remove(path);
        return 0;
    }
    if (!check(corrupt_copy(path, corrupt_path),
               "a corruption control can be written")) {
        (void)remove(path);
        return 0;
    }
    status = r32_model_load(&corrupted, corrupt_path, error, sizeof(error));
    (void)remove(path);
    (void)remove(corrupt_path);
    if (!check(status == R0_IO_ERROR,
               "one changed payload bit is rejected before replay"))
        return 0;
    puts("Reasoner (3,2) exact sparse compression self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    R31Model dense;
    R31TrainingReport training;
    R32Model sparse;
    R32CompressionReport report;
    R31Invariant invariant;
    R31AnswerIR answer;
    uint32_t calls;
    uint16_t program_index;
    char output[256], error[256] = {0};
    R0Status status;

    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "demo") == 0) {
        status = r31_train(&dense, &training, error, sizeof(error));
        if (status == R0_OK)
            status = r32_compress(&dense, &sparse, &report, error,
                                  sizeof(error));
        if (status != R0_OK) goto fail;
        print_compression(&report, NULL);
        return EXIT_SUCCESS;
    }
    if (argc == 3 && strcmp(argv[1], "build") == 0) {
        status = r31_train(&dense, &training, error, sizeof(error));
        if (status == R0_OK)
            status = r32_compress(&dense, &sparse, &report, error,
                                  sizeof(error));
        if (status == R0_OK)
            status = r32_model_save(&sparse, argv[2], error,
                                    sizeof(error));
        if (status != R0_OK) goto fail;
        print_compression(&report, argv[2]);
        return EXIT_SUCCESS;
    }
    if (argc == 4 && strcmp(argv[1], "compress") == 0) {
        status = r31_model_load(&dense, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r32_compress(&dense, &sparse, &report, error,
                                  sizeof(error));
        if (status == R0_OK)
            status = r32_model_save(&sparse, argv[3], error,
                                    sizeof(error));
        if (status != R0_OK) goto fail;
        print_compression(&report, argv[3]);
        return EXIT_SUCCESS;
    }
    if (argc == 4 && strcmp(argv[1], "verify") == 0) {
        status = r31_model_load(&dense, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r32_model_load(&sparse, argv[3], error, sizeof(error));
        if (status == R0_OK)
            status = r32_verify_equivalence(&dense, &sparse, &report, error,
                                            sizeof(error));
        if (status != R0_OK) goto fail;
        print_equivalence(&report);
        return report.exact ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    if (argc == 4 && strcmp(argv[1], "render") == 0) {
        if (!parse_u16(argv[3], (uint16_t)(r31_program_count() - 1),
                       &program_index))
            goto bad_usage;
        status = r32_model_load(&sparse, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r32_solve(&sparse, program_index, &invariant, &calls,
                               error, sizeof(error));
        if (status == R0_OK)
            status = r31_answer_seal(program_index, &invariant, &answer,
                                     error, sizeof(error));
        if (status == R0_OK)
            status = r31_language_render(&answer, output, sizeof(output),
                                         error, sizeof(error));
        if (status != R0_OK) goto fail;
        printf("%s\n", output);
        return EXIT_SUCCESS;
    }
bad_usage:
    usage(argv[0]);
    return EXIT_FAILURE;
fail:
    fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
    return EXIT_FAILURE;
}
