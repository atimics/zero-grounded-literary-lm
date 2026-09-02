CC ?= cc
CFLAGS ?= -O2 -std=c11 -Wall -Wextra -Wpedantic
LITERARY_BACKEND ?= auto
EMCC ?= emcc
ZERO5_THREAD_FLAGS ?= -pthread
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)
GNU_LIBMVEC_CFLAGS :=
ifeq ($(UNAME_S),Linux)
ifeq ($(UNAME_M),x86_64)
GNU_LIBMVEC_CFLAGS := -mavx2 -DUSE_GNU_LIBMVEC
endif
endif
ifeq ($(UNAME_S),Darwin)
CPU_FAST_CFLAGS := -O3 -mcpu=native -flto -fno-math-errno \
	-DUSE_VECTOR_MATH
else
CPU_FAST_CFLAGS := -O3 -march=native -flto -fno-math-errno \
	-DUSE_VECTOR_MATH
endif
KJV_URL := https://www.gutenberg.org/ebooks/30.txt.utf-8
ZERO2_CHECKPOINT ?= literary-v8-consolidated.ckpt
ZERO3_STEPS ?= 6000
ZERO3_CONSOLIDATION_STEPS ?= 1200
ZERO3_BALANCE_STEPS ?= 400
ZERO_DATA_OUT ?= build/zero-literary-v1
SERO_CORPUS_WORK ?= build/sero-corpus-v1
SERO_CORPUS_OUT ?= build/sero-pretrain-v1
SERO_LATENT_V3_MANIFEST ?= $(SERO_CORPUS_OUT)/manifest.json
SERO_LATENT_PYTHON ?= python3
SERO_LATENT_V3_PYTHON ?= python3
SERO1_PRETRAIN_PYTHON ?= python3
SERO1_PRETRAIN_MANIFEST ?= $(SERO_CORPUS_OUT)/manifest.json
SERO1_OPTIMIZED_MANIFEST ?= build/sero-pretrain-v2/manifest.json
SERO2_CURRICULUM_MANIFEST ?= build/sero-pretrain-curriculum-v1/manifest.json
SERO0_OUT ?= build/sero0
ZERO5_C0_OUT ?= build/zero5-c0-v1
ZERO5_C0_MAX_TOKENS ?= 8000000
ZERO5_BRAID_COLLECTION_ID ?=
ZERO5_BRAID_COMMIT ?=
ZERO5_C1_OUT ?= build/zero5-c1-v1
ZERO5_C1_C0_DIR ?= build/zero5-c0-v1/corpus-one
ZERO5_C2_IMPORT_DIR ?= build/zero5-c2-v1/import-final
ZERO5_C2_C0_DIR ?= build/zero5-c0-v1/corpus-one
ZERO5_C2_C1_DIR ?= build/zero5-c1-v1
ZERO5_C2_OUT ?= build/zero5-c2-v1/run
ZERO5_C3_IMPORT_DIR ?= build/zero5-c3-v1/import-final
ZERO5_C3_C0_DIR ?= build/zero5-c0-v1/corpus-one
ZERO5_C3_C2_DIR ?= build/zero5-c2-v1/run
ZERO5_C3_C2_IMPORT_DIR ?= build/zero5-c2-v1/import-final
ZERO5_C3_OUT ?= build/zero5-c3-v1/run
ZERO5_C31_IMPORT_DIR ?= build/zero5-c31-v1/import-final
ZERO5_C31_C0_DIR ?= build/zero5-c0-v1/corpus-one
ZERO5_C31_C2_DIR ?= build/zero5-c2-v1/run
ZERO5_C31_C2_IMPORT_DIR ?= build/zero5-c2-v1/import-final
ZERO5_C31_OUT ?= build/zero5-c31-v1/run
ZERO5_C32_IMPORT_DIR ?= build/zero5-c32-v1/import-final
ZERO5_C32_C0_DIR ?= build/zero5-c0-v1/corpus-one
ZERO5_C32_C2_DIR ?= build/zero5-c2-v1/run
ZERO5_C32_C2_IMPORT_DIR ?= build/zero5-c2-v1/import-final
ZERO5_C32_OUT ?= build/zero5-c32-v1/run
ZERO5_C33_IMPORT_DIR ?= build/zero5-c33-v1/import-final
ZERO5_C33_C0_DIR ?= build/zero5-c0-v1/corpus-one
ZERO5_C33_C2_DIR ?= build/zero5-c2-v1/run
ZERO5_C33_C2_IMPORT_DIR ?= build/zero5-c2-v1/import-final
ZERO5_C33_OUT ?= build/zero5-c33-v1/run
ZERO5_C33_PARALLEL_OUT ?= build/zero5-c33-parallel-v1/run
ZERO5_C42_IMPORT_DIR ?= build/zero5-c42-v1/import-final
ZERO5_C42_C0_DIR ?= build/zero5-c0-v1/corpus-one
ZERO5_C42_C2_DIR ?= build/zero5-c2-v1/run
ZERO5_C42_C2_IMPORT_DIR ?= build/zero5-c2-v1/import-final
ZERO5_C42_OUT ?= build/zero5-c42-v1/run
ZERO4_Q1_STEPS ?= 4000
ZERO4_Q1_BATCH ?= 2
ZERO4_Q1_SEED ?= 1
ZERO4_Q1_PREFIX ?= /tmp/zero4-q1-seed$(ZERO4_Q1_SEED)
ZERO4_Q1_RESULTS ?= benchmarks/zero4-q1-v1
ZERO4_Q2_STEPS ?= 2000
ZERO4_Q2_BATCH ?= 2
ZERO4_Q2_SEED ?= 1
ZERO4_Q2_PREFIX ?= /tmp/zero4-q2-seed$(ZERO4_Q2_SEED)
ZERO4_Q2_RESULTS ?= benchmarks/zero4-q2-v1
ZERO4_Q2_EVAL_LIMIT ?= 500
ZERO4_Q21_STEPS ?= 1000
ZERO4_Q21_BATCH ?= 2
ZERO4_Q21_SEED ?= 1
ZERO4_Q21_PREFIX ?= /tmp/zero4-q21-seed$(ZERO4_Q21_SEED)
ZERO4_Q21_RESULTS ?= benchmarks/zero4-q21-v1
ZERO4_Q21_EVAL_LIMIT ?= 500
ZERO4_Q21_CONSOLIDATION_STEPS ?= 400
ZERO4_Q21_TOTAL_STEPS ?= 1400
ZERO4_Q21_FINAL_PREFIX ?= /tmp/zero4-q21-seed$(ZERO4_Q21_SEED)-consolidated
ZERO4_Q22_STEPS ?= 1000
ZERO4_Q22_CONSOLIDATION_STEPS ?= 400
ZERO4_Q22_TOTAL_STEPS ?= 1400
ZERO4_Q22_BATCH ?= 2
ZERO4_Q22_SEED ?= 1
ZERO4_Q22_EXPERIMENT ?= q22
ZERO4_Q22_PREFIX ?= /tmp/zero4-q22-seed$(ZERO4_Q22_SEED)
ZERO4_Q22_RESULTS ?= benchmarks/zero4-q22-v1/seed$(ZERO4_Q22_SEED)
ZERO4_Q22R_STEPS ?= 100
ZERO4_Q22R_BATCH ?= 2
ZERO4_Q22R_SEED ?= 2
ZERO4_Q22R_STARTS ?= 400,300
ZERO4_Q22R_SOURCE ?= benchmarks/zero4-q22-v1/seed$(ZERO4_Q22R_SEED)/selection.json
ZERO4_Q22R_PREFIX ?= /tmp/zero4-q22r-seed$(ZERO4_Q22R_SEED)
ZERO4_Q22R_RESULTS ?= benchmarks/zero4-q22r-v1/seed$(ZERO4_Q22R_SEED)
ZERO4_Q23_SEED ?= 2
ZERO4_Q23_PREFIX ?= /tmp/zero4-q23-seed$(ZERO4_Q23_SEED)
ZERO4_Q23_RESULTS ?= benchmarks/zero4-q23-v1/seed$(ZERO4_Q23_SEED)
ZERO4_Q23_OBSERVER_PREFIX ?= /tmp/zero4-q23-observer-seed$(ZERO4_Q23_SEED)
ZERO4_Q23_OBSERVER_RESULTS ?= benchmarks/zero4-q23-v1/observer-seed$(ZERO4_Q23_SEED)
ZERO4_Q24_SEED ?= 2
ZERO4_Q24_PREFIX ?= /tmp/zero4-q24-seed$(ZERO4_Q24_SEED)
ZERO4_Q24_RESULTS ?= benchmarks/zero4-q24-v1/seed$(ZERO4_Q24_SEED)
Q24_CI_REPLAY_ARGS = --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt
ZERO4_Q25_SEED ?= 2
ZERO4_Q25_PREFIX ?= /tmp/zero4-q25-seed$(ZERO4_Q25_SEED)
ZERO4_Q25_RESULTS ?= benchmarks/zero4-q25-v1/seed$(ZERO4_Q25_SEED)
Q25_CI_REPLAY_ARGS = --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt
ZERO4_Q26_SEED ?= 2
ZERO4_Q26_PREFIX ?= /tmp/zero4-q26-seed$(ZERO4_Q26_SEED)
ZERO4_Q26_RESULTS ?= benchmarks/zero4-q26-v1/seed$(ZERO4_Q26_SEED)
ZERO4_PROMOTED_ARTIFACT ?= benchmarks/zero4-q26-v1/seed2/selected.litq8
ZERO4_Q26R_SEED ?= 1
ZERO4_Q26R_PREFIX ?= /tmp/zero4-q26r-seed$(ZERO4_Q26R_SEED)
ZERO4_Q26R_RESULTS ?= benchmarks/zero4-q26r-v1/seed$(ZERO4_Q26R_SEED)
ZERO4_Q26R_CONTRACT ?= benchmarks/zero4-q26r-v1/contract.json
ZERO_CHANNEL_MODEL ?= benchmarks/zero-channel-v1/model.litq8
Q26_CI_REPLAY_ARGS = --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt --text corpus/zero-foundation.txt
MONKEY_PREFIX ?= infinite-monkey-v1
MONKEY_BF_EXAMPLES ?= 30000
MONKEY_LOGIC_EXAMPLES ?= 100000
MONKEY_BF_STEPS ?= 12000
MONKEY_LOGIC_STEPS ?= 12000
MONKEY_SHAKESPEARE_STEPS ?= 6000
MONKEY_BLAKE_STEPS ?= 4000
MONKEY_CROWLEY_STEPS ?= 4000
MONKEY_CONSOLIDATE_STEPS ?= 4000
MONKEY_LITERARY_STEPS ?= 6000
MONKEY_REBALANCE_STEPS ?= 2000
MONKEY_BATCH ?= 2
MONKEY_SEED ?= 89
MONKEY_RESULTS ?= benchmarks/infinite-monkey-v1
MONKEY_TRACE_PREFIX ?= infinite-monkey-trace10m-v2
MONKEY_TRACE_EXAMPLES ?= 60000
MONKEY_TRACE_STEPS ?= 12000
MONKEY_TRACE_BATCH ?= 2
MONKEY_TRACE_RESULTS ?= benchmarks/infinite-monkey-trace10m-v2
HF_OUT ?= /tmp/zero4-huggingface-release

ifeq ($(UNAME_S),Darwin)
ifneq ($(filter $(LITERARY_BACKEND),auto accelerate portable),$(LITERARY_BACKEND))
$(error unsupported LITERARY_BACKEND=$(LITERARY_BACKEND))
endif
ifeq ($(LITERARY_BACKEND),portable)
LITERARY_CFLAGS :=
LITERARY_LDLIBS := -lm
else
LITERARY_CFLAGS := -DUSE_ACCELERATE -DACCELERATE_NEW_LAPACK
LITERARY_LDLIBS := -framework Accelerate -lm
endif
else
ifneq ($(filter $(LITERARY_BACKEND),auto openblas portable),$(LITERARY_BACKEND))
$(error unsupported LITERARY_BACKEND=$(LITERARY_BACKEND))
endif
OPENBLAS_CFLAGS := $(shell pkg-config --cflags openblas 2>/dev/null)
OPENBLAS_LDLIBS := $(shell pkg-config --libs openblas 2>/dev/null)
ifeq ($(LITERARY_BACKEND),portable)
LITERARY_CFLAGS :=
LITERARY_LDLIBS := -lm
else ifneq ($(strip $(OPENBLAS_LDLIBS)),)
LITERARY_CFLAGS := -DUSE_CBLAS $(OPENBLAS_CFLAGS)
LITERARY_LDLIBS := $(OPENBLAS_LDLIBS) -lm
else ifeq ($(LITERARY_BACKEND),openblas)
$(error OpenBLAS requested but pkg-config could not find openblas)
else
LITERARY_CFLAGS :=
LITERARY_LDLIBS := -lm
endif
endif

.PHONY: all check clean web channel-data zero3-data zero3-stage1 \
	zero-data-build zero-data-pipeline-check \
	zero5-cpu-speed-check zero5-cpu-profile-check zero5-cpu-profile-aws-check \
	zero5-cpu-profile-aws-result-check \
	zero5-vector-math-check \
	zero5-vector-math-aws-check \
	zero5-vector-math-aws-result-check \
	zero5-vector-validation-check \
	zero5-vector-validation-aws-check \
	zero5-vector-validation-aws-result-check \
	zero5-blocked-attention-check \
	zero5-tensor-batch-check \
	zero5-tensor-aws-check \
	zero5-tensor-aws-result-check \
	sero-corpus-plan-check sero-corpus-prepare sero-corpus-build \
	sero-corpus-result-check \
	sero0-tokenizer sero0-check zero5-c0-check zero5-c0-run \
	zero5-c1-check zero5-c1-run \
	zero5-c2-check zero5-c2-run \
	zero5-c3-check zero5-c3-run \
	zero5-c31-check zero5-c31-run \
	zero5-c32-check zero5-c32-run \
	zero5-c33-check zero5-c33-run \
	zero5-c33-parallel-check zero5-c33-parallel-result-check \
	zero5-c33-parallel-run \
	zero5-c42-check zero5-c42-aws-check zero5-c42-result-check zero5-c42-run \
	zero5-c43-spec-check zero5-c43-prep-check zero5-c43-contract-check \
	zero5-c43-result-check zero5-c51-result-check zero5-c52-result-check zero5-c51-statebridge-check \
	zero5-c61-shared-state-check \
	zero5-hierarchical-tokenization-check \
	sero-latent-v1-check sero-latent-v1-pilot \
	sero-latent-v1-conventional sero-latent-v1-result-check \
	sero-latent-v2-check sero-latent-v2-run sero-latent-v2-result-check \
	sero-latent-v3-contract-check sero-latent-v3-check \
	sero-latent-v3-smoke sero-latent-v3-run sero-latent-v3-result-check \
	sero-latent-v3-aws-check \
	sero1-tokenizer-lock sero1-tokenizer-check \
	sero1-pretrain-contract-check sero1-pretrain-check \
	sero1-pretrain-result-check sero1-pretrain-aws-check \
	sero1-generation-eval-result-check sero1-optimized-contract-check \
	sero1-optimized-check sero2-curriculum-contract-check \
	sero2-curriculum-check sero2-curriculum-result-check \
	sero2-curriculum-replication-contract-check \
	sero2-curriculum-consolidation-replication-contract-check \
	sero2-curriculum-consolidation-replication-result-check \
	sero20m-curriculum-contract-check \
	sero20m-consolidation-contract-check \
	sero-series-closure-check \
	sero20m-scale-generation-contract-check \
	zero3-consolidate zero3-balance zero3-train zero-benchmark \
	zero-benchmark-check zero4-faculty-data zero4-faculty-check zero4-smoke \
	zero4-q1-train zero4-q1-eval zero4-q1 zero4-q2-data zero4-q2-check \
	zero4-q2-train zero4-q2-eval zero4-q2 zero4-q21-data zero4-q21-check \
	zero4-q21-train zero4-q21-consolidate zero4-q21-eval zero4-q21 \
	zero4-q22-data zero4-q22-shared-task-check zero4-q22-compositional-shared-task-check zero4-q22-check zero4-q22-train zero4-q22-eval zero4-q22 \
	zero4-q22r-check zero4-q22r-train zero4-q22r-eval zero4-q22r \
	zero4-q22r-aggregate \
	zero4-q23-check zero4-q23-observer zero4-q23-train zero4-q23 \
	zero4-q24-check zero4-q24-train zero4-q24 \
	zero4-q25-check zero4-q25-train zero4-q25 \
	zero4-q26-check zero4-q26-train zero4-q26 \
	zero4-q27-check zero4-post-q27-research-check zero4-q28-check \
	zero4-q28-activation-check zero4-q28-language-gate-check \
	zero4-q28-u100-language-gate-check zero4-q29-check \
	zero4-q29-language-gate-check \
	zero4-q32-check zero4-q32-result-check \
	zero4-q32-public-check \
	zero4-q32-public-result-check \
	zero4-q32-promotion-check \
	zero4-q32-promotion-result-check \
	zero4-q33-semantic-check \
	zero4-q33-semantic-result-check \
	zero4-q34-semantic-head-check \
	zero4-q34-semantic-head-result-check \
	zero4-q26r-check zero4-q26r-train zero4-q26r zero4-q26r-aggregate \
	zero4-q26r-aws-v2-check \
	zero4-promotion-check promote-zero4 \
	external-eval-check \
	zero-eval1-calibration-check zero-eval1-full-budget-check \
	zero-eval1-screen-check zero-eval1-full-run-decision-check \
	zero-language-gate-check sat1-prereg-check \
	experiment-budget-check experiment-evidence-check \
	literature-review-pipeline-check literature-review-q27 \
	corpus-rights-check zero4-memorization-check huggingface-release-stage \
	quantity-request-eval-check \
	brainfuck-data monkey-data \
	monkey-bf monkey-logic monkey-shakespeare monkey-blake monkey-crowley \
	monkey-consolidate monkey-literary monkey-rebalance monkey-train \
	monkey-smoke monkey-eval brainfuck-trace-data monkey-trace10m-data \
	monkey-trace10m-smoke monkey-trace10m-train monkey-trace10m-eval

# Best checkpoints are valid, atomically written artifacts even when a later
# update is interrupted. Preserve them so a measured early stop can advance to
# the next cumulative curriculum stage.
.PRECIOUS: $(MONKEY_PREFIX)-bf.ckpt $(MONKEY_PREFIX)-logic.ckpt \
	$(MONKEY_PREFIX)-shakespeare.ckpt $(MONKEY_PREFIX)-blake.ckpt \
	$(MONKEY_PREFIX)-crowley.ckpt $(MONKEY_PREFIX)-final.ckpt \
	$(MONKEY_PREFIX)-literary.ckpt $(MONKEY_PREFIX)-balanced.ckpt \
	$(MONKEY_TRACE_PREFIX)-brainfuck.ckpt

all: zero_lm literary_lm zero5_lm zero5_c2_lm zero5_c3_lm zero5_c31_lm zero5_c32_lm bpe_tokenizer sero_tokenizer zero5_braid logic_corpus brainfuck_corpus channel_corpus faculty_controller export_literary freeze_literary_teacher literary_infer memorization_eval zero_eval faculty_eval quantity_request_eval external_eval
all: reasoner0 reasoner1 reasoner2 reasoner3 reasoner31 reasoner32 reasoner33 \
	reasoner34 reasoner333 reasoner34_witness reasoner35 reasoner36 reasoner37 \
	reasoner38 reasoner39 reasoner310 reasoner40 reasoner41 reasoner42 \
	weight_multiplicity

.PHONY: reasoner0-check reasoner1-check reasoner2-check reasoner3-check \
	reasoner31-check reasoner32-check reasoner33-check reasoner34-check \
	reasoner34-contract-check reasoner333-check reasoner34-witness-check \
	reasoner35-check reasoner35-contract-check reasoner36-check \
	reasoner36-contract-check reasoner37-check reasoner37-contract-check \
	reasoner38-check reasoner38-contract-check reasoner39-check \
	reasoner39-contract-check reasoner310-check reasoner310-contract-check \
	reasoner40-check reasoner40-contract-check reasoner40-result-check \
	reasoner41-check reasoner41-contract-check reasoner41-result-check \
	reasoner42-check reasoner42-contract-check reasoner42-result-check \
	weight-multiplicity-check

reasoner0: reasoner0.c reasoner0_cli.c reasoner0.h
	$(CC) $(CFLAGS) reasoner0.c reasoner0_cli.c -o $@

reasoner0-check: reasoner0
	./reasoner0 --self-test

reasoner1: reasoner0.c reasoner1.c reasoner1_cli.c reasoner0.h reasoner1.h
	$(CC) $(CFLAGS) reasoner0.c reasoner1.c reasoner1_cli.c -o $@

reasoner1-check: reasoner1
	./reasoner1 --self-test

reasoner2: reasoner0.c reasoner2.c reasoner2_cli.c reasoner0.h reasoner2.h
	$(CC) $(CFLAGS) reasoner0.c reasoner2.c reasoner2_cli.c -o $@

reasoner2-check: reasoner2
	./reasoner2 --self-test

weight_multiplicity: reasoner0.c weight_multiplicity.c \
		weight_multiplicity_cli.c reasoner0.h weight_multiplicity.h
	$(CC) $(CFLAGS) -pthread reasoner0.c weight_multiplicity.c \
		weight_multiplicity_cli.c -o $@

weight_multiplicity_crosscheck: reasoner0.c weight_multiplicity.c \
		weight_multiplicity_cli.c reasoner0.h weight_multiplicity.h
	$(CC) $(CFLAGS) -pthread -DWM_CANONICALIZATION_CROSSCHECK \
		-DWM_ROOT_ORBIT_CROSSCHECK reasoner0.c \
		weight_multiplicity.c weight_multiplicity_cli.c -o $@

weight-multiplicity-check: weight_multiplicity weight_multiplicity_crosscheck
	./weight_multiplicity --self-test
	./weight_multiplicity_crosscheck --self-test

reasoner3: reasoner0.c reasoner3.c reasoner3_cli.c reasoner0.h reasoner3.h
	$(CC) $(CFLAGS) reasoner0.c reasoner3.c reasoner3_cli.c -o $@

reasoner3-check: reasoner3
	./reasoner3 --self-test

reasoner31: reasoner0.c reasoner31.c reasoner31_cli.c reasoner0.h reasoner31.h
	$(CC) $(CFLAGS) reasoner0.c reasoner31.c reasoner31_cli.c -o $@

reasoner31-check: reasoner31
	./reasoner31 --self-test

reasoner32: reasoner0.c reasoner31.c reasoner32.c reasoner32_cli.c \
		reasoner0.h reasoner31.h reasoner32.h
	$(CC) $(CFLAGS) reasoner0.c reasoner31.c reasoner32.c \
		reasoner32_cli.c -o $@

reasoner32-check: reasoner32
	./reasoner32 --self-test

reasoner33: reasoner0.c reasoner31.c reasoner32.c reasoner33.c \
		reasoner33_cli.c reasoner0.h reasoner31.h reasoner32.h reasoner33.h
	$(CC) $(CFLAGS) reasoner0.c reasoner31.c reasoner32.c reasoner33.c \
		reasoner33_cli.c -o $@

reasoner33-check: reasoner33
	./reasoner33 --self-test

reasoner34: reasoner0.c reasoner34.c reasoner34_cli.c reasoner0.h reasoner34.h
	$(CC) $(CFLAGS) reasoner0.c reasoner34.c reasoner34_cli.c -o $@

reasoner34-check: reasoner34
	./reasoner34 --self-test

reasoner34-contract-check:
	node scripts/check_reasoner34_contract.mjs

reasoner333: reasoner333.c reasoner333_cli.c reasoner333.h
	$(CC) $(CFLAGS) reasoner333.c reasoner333_cli.c -o $@

reasoner333-check: reasoner333
	./reasoner333 --self-test

reasoner34_witness: reasoner0.c reasoner31.c reasoner32.c reasoner33.c \
		reasoner34_witness.c reasoner34_witness_cli.c reasoner0.h reasoner31.h \
		reasoner32.h reasoner33.h reasoner34_witness.h
	$(CC) $(CFLAGS) reasoner0.c reasoner31.c reasoner32.c reasoner33.c \
		reasoner34_witness.c reasoner34_witness_cli.c -o $@

reasoner34-witness-check: reasoner34_witness
	./reasoner34_witness --self-test

reasoner35: reasoner0.c reasoner31.c reasoner32.c reasoner33.c reasoner34.c \
		reasoner333.c reasoner34_witness.c reasoner35.c reasoner35_cli.c \
		reasoner0.h reasoner31.h reasoner32.h reasoner33.h reasoner34.h \
		reasoner333.h reasoner34_witness.h reasoner35.h
	$(CC) $(CFLAGS) reasoner0.c reasoner31.c reasoner32.c reasoner33.c \
		reasoner34.c reasoner333.c reasoner34_witness.c reasoner35.c \
		reasoner35_cli.c -o $@

reasoner35-check: reasoner35
	./reasoner35 --self-test

reasoner35-contract-check:
	node scripts/check_reasoner35_contract.mjs

reasoner36: reasoner0.c reasoner36.c reasoner36_cli.c reasoner0.h reasoner36.h
	$(CC) $(CFLAGS) reasoner0.c reasoner36.c reasoner36_cli.c -o $@

reasoner36-check: reasoner36
	./reasoner36 --self-test

reasoner36-contract-check:
	node scripts/check_reasoner36_contract.mjs

reasoner37: reasoner0.c reasoner36.c reasoner37.c reasoner37_cli.c \
		reasoner0.h reasoner36.h reasoner37.h
	$(CC) $(CFLAGS) reasoner0.c reasoner36.c reasoner37.c \
		reasoner37_cli.c -o $@

reasoner37-check: reasoner37
	./reasoner37 --self-test

reasoner37-contract-check:
	node scripts/check_reasoner37_contract.mjs

reasoner38: reasoner0.c reasoner38.c reasoner38_cli.c reasoner0.h reasoner38.h
	$(CC) $(CFLAGS) reasoner0.c reasoner38.c reasoner38_cli.c -o $@

reasoner38-check: reasoner38
	./reasoner38 --self-test

reasoner38-contract-check:
	node scripts/check_reasoner38_contract.mjs

reasoner39: reasoner0.c reasoner39.c reasoner39_cli.c reasoner0.h reasoner39.h
	$(CC) $(CFLAGS) reasoner0.c reasoner39.c reasoner39_cli.c -o $@

reasoner39-check: reasoner39
	./reasoner39 --self-test

reasoner39-contract-check:
	node scripts/check_reasoner39_contract.mjs

reasoner310: reasoner0.c reasoner310.c reasoner310_cli.c reasoner0.h \
		reasoner310.h
	$(CC) $(CFLAGS) reasoner0.c reasoner310.c reasoner310_cli.c -o $@

reasoner310-check: reasoner310
	./reasoner310 --self-test

reasoner310-contract-check:
	node scripts/check_reasoner310_contract.mjs

reasoner40: reasoner0.c reasoner310.c reasoner310.h reasoner40.c \
		reasoner40_cli.c reasoner0.h reasoner40.h
	$(CC) $(CFLAGS) reasoner0.c reasoner40.c reasoner40_cli.c -o $@

reasoner40-check: reasoner40
	./reasoner40 --self-test
	@if ./reasoner40 sealed-run /tmp/reasoner40-unauthorized.json \
			>/dev/null 2>&1; then \
		echo "Reasoner 4.0 sealed execution unexpectedly opened"; exit 1; \
	fi

reasoner40-contract-check:
	node scripts/check_reasoner40_contract.mjs
	bash -n scripts/aws/reasoner40-stage.sh \
		scripts/aws/reasoner40-run-instance.sh \
		scripts/aws/reasoner40-user-data.sh

reasoner40-result-check:
	node scripts/check_reasoner40_result.mjs

reasoner41: reasoner0.c reasoner310.c reasoner310.h reasoner40.c \
		reasoner40.h reasoner41.c reasoner41_cli.c reasoner0.h reasoner41.h
	$(CC) $(CFLAGS) reasoner0.c reasoner41.c reasoner41_cli.c -o $@

reasoner41-check: reasoner41
	./reasoner41 --self-test
	@if ./reasoner41 sealed-run /tmp/reasoner41-unauthorized.json \
			>/dev/null 2>&1; then \
		echo "Reasoner 4.1 sealed execution unexpectedly opened"; exit 1; \
	fi

reasoner41-contract-check: reasoner41
	node scripts/check_reasoner41_contract.mjs
	bash -n scripts/aws/reasoner41-stage.sh \
		scripts/aws/reasoner41-run-instance.sh \
		scripts/aws/reasoner41-user-data.sh

reasoner41-result-check:
	node scripts/check_reasoner41_result.mjs

reasoner42: reasoner0.c reasoner310.c reasoner310.h reasoner40.c \
		reasoner40.h reasoner42.c reasoner42_cli.c reasoner0.h reasoner42.h
	$(CC) $(CFLAGS) reasoner0.c reasoner42.c reasoner42_cli.c -o $@

reasoner42-check: reasoner42
	./reasoner42 --self-test
	@if ./reasoner42 sealed-run /tmp/reasoner42-unauthorized.json \
			>/dev/null 2>&1; then \
		echo "Reasoner 4.2 sealed execution unexpectedly opened"; exit 1; \
	fi

reasoner42-contract-check: reasoner42
	node scripts/check_reasoner42_contract.mjs
	bash -n scripts/aws/reasoner42-stage.sh \
		scripts/aws/reasoner42-run-instance.sh \
		scripts/aws/reasoner42-user-data.sh

reasoner42-result-check:
	node scripts/check_reasoner42_result.mjs

sero_tokenizer: sero_tokenizer.c
	$(CC) $(CFLAGS) sero_tokenizer.c -o $@

zero5_braid: zero5_braid.c
	$(CC) $(CFLAGS) zero5_braid.c -o $@

sero0-tokenizer: sero_tokenizer
	mkdir -p "$(SERO0_OUT)"
	./sero_tokenizer init --vocab "$(SERO0_OUT)/tokenizer.sero"

sero0-check: sero_tokenizer
	node scripts/check_sero0.mjs

zero5-c0-check: zero5_braid sero_tokenizer bpe_tokenizer zero5_lm
	node scripts/check_zero5_c0.mjs

zero5-c0-run: zero5_braid sero_tokenizer bpe_tokenizer zero5_lm
	test -n "$(BRAID_RELEASE)"
	node scripts/run_zero5_c0.mjs --release "$(BRAID_RELEASE)" \
		--out "$(ZERO5_C0_OUT)" \
		--maximum-tokenizer-training-tokens "$(ZERO5_C0_MAX_TOKENS)" \
		--collection-id "$(ZERO5_BRAID_COLLECTION_ID)" \
		--braid-commit "$(ZERO5_BRAID_COMMIT)"

zero5-c1-check:
	node scripts/check_zero5_c1.mjs

zero5-c1-run: zero5_lm zero5-c1-check
	node scripts/run_zero5_c1.mjs \
		--c0-dir "$(ZERO5_C1_C0_DIR)" --out "$(ZERO5_C1_OUT)"

zero5-c2-check: zero5_c2_lm
	node scripts/check_zero5_c2.mjs

zero5-c2-run: zero5_c2_lm zero5-c2-check
	node scripts/run_zero5_c2.mjs \
		--import-dir "$(ZERO5_C2_IMPORT_DIR)" \
		--c0-dir "$(ZERO5_C2_C0_DIR)" \
		--c1-dir "$(ZERO5_C2_C1_DIR)" --out "$(ZERO5_C2_OUT)"

zero5-c3-check: zero5_c3_lm
	node scripts/check_zero5_c3.mjs

zero5-c3-run: zero5_c3_lm zero5-c3-check
	node scripts/run_zero5_c3.mjs \
		--import-dir "$(ZERO5_C3_IMPORT_DIR)" \
		--c0-dir "$(ZERO5_C3_C0_DIR)" \
		--c2-dir "$(ZERO5_C3_C2_DIR)" \
		--c2-import-dir "$(ZERO5_C3_C2_IMPORT_DIR)" \
		--out "$(ZERO5_C3_OUT)"

zero5-c31-check: zero5_c31_lm
	node scripts/check_zero5_c31.mjs

zero5-c31-run: zero5_c31_lm zero5-c31-check
	node scripts/run_zero5_c31.mjs \
		--import-dir "$(ZERO5_C31_IMPORT_DIR)" \
		--c0-dir "$(ZERO5_C31_C0_DIR)" \
		--c2-dir "$(ZERO5_C31_C2_DIR)" \
		--c2-import-dir "$(ZERO5_C31_C2_IMPORT_DIR)" \
		--out "$(ZERO5_C31_OUT)"

zero5-c32-check: zero5_c32_lm
	node scripts/check_zero5_c32.mjs

zero5-c32-throughput-check:
	node scripts/check_zero5_c32_throughput.mjs

zero5-c32-run: zero5_c32_lm zero5-c32-check
	node scripts/run_zero5_c32.mjs \
		--import-dir "$(ZERO5_C32_IMPORT_DIR)" \
		--c0-dir "$(ZERO5_C32_C0_DIR)" \
		--c2-dir "$(ZERO5_C32_C2_DIR)" \
		--c2-import-dir "$(ZERO5_C32_C2_IMPORT_DIR)" \
		--out "$(ZERO5_C32_OUT)"

zero5-c33-check: zero5_c32_lm
	node scripts/check_zero5_c33.mjs

zero5-c33-run: zero5_c32_lm zero5-c33-check
	node scripts/run_zero5_c33.mjs \
		--import-dir "$(ZERO5_C33_IMPORT_DIR)" \
		--c0-dir "$(ZERO5_C33_C0_DIR)" \
		--c2-dir "$(ZERO5_C33_C2_DIR)" \
		--c2-import-dir "$(ZERO5_C33_C2_IMPORT_DIR)" \
		--out "$(ZERO5_C33_OUT)"

zero5-c33-parallel-check: zero5_c32_lm_fast
	node scripts/check_zero5_c33_parallel.mjs

zero5-c33-parallel-result-check:
	node scripts/check_zero5_c33_parallel_result.mjs

zero5-c33-parallel-run: zero5_c32_lm_fast zero5-c33-parallel-check
	node scripts/run_zero5_c33_parallel.mjs \
		--import-dir "$(ZERO5_C33_IMPORT_DIR)" \
		--c0-dir "$(ZERO5_C33_C0_DIR)" \
		--c2-dir "$(ZERO5_C33_C2_DIR)" \
		--out "$(ZERO5_C33_PARALLEL_OUT)"

zero5-c42-check: zero5_c32_lm_fast zero5_c32_lm_tensor
	node scripts/check_zero5_c42.mjs

zero5-c42-aws-check: zero5-c42-check
	node scripts/check_zero5_c42_aws.mjs
	bash -n scripts/aws/zero5-c42-stage.sh
	bash -n scripts/aws/zero5-c42-run-instance.sh
	bash -n scripts/aws/zero5-c42-user-data.sh

zero5-c42-result-check:
	node scripts/check_zero5_c42_result.mjs

zero5-c43-spec-check:
	node scripts/check_zero5_c43_spec.mjs

zero5-c43-prep-check: zero5-c43-spec-check
	node scripts/check_zero5_c43_prep.mjs
	node scripts/prepare_zero5_c43.mjs --self-test
	node scripts/run_zero5_c43_pilot.mjs --self-test

zero5-c43-contract-check: zero5-c43-prep-check
	node scripts/check_zero5_c43_contract.mjs

zero5-c43-result-check: zero5-c43-contract-check
	node scripts/check_zero5_c43_result.mjs

zero5-c51-result-check:
	node scripts/check_zero5_c51_result.mjs

zero5-c52-result-check:
	node scripts/check_zero5_c52_result.mjs

zero5-c51-statebridge-check:
	node scripts/check_zero5_c51.mjs

zero5-c52-targetbridge-check: zero5_c51_target_lm
	node scripts/check_zero5_c52_targetbridge.mjs

zero5-c61-shared-state-check: zero5_c61_bottleneck_lm
	node scripts/check_zero5_c61_shared_state.mjs

zero5-hierarchical-tokenization-check:
	node scripts/check_zero5_hierarchical_tokenization.mjs

zero5-c42-run: zero5_c32_lm_vector_math zero5-c42-aws-check
	node scripts/run_zero5_c42.mjs \
		--import-dir "$(ZERO5_C42_IMPORT_DIR)" \
		--c0-dir "$(ZERO5_C42_C0_DIR)" \
		--c2-dir "$(ZERO5_C42_C2_DIR)" \
		--c2-import-dir "$(ZERO5_C42_C2_IMPORT_DIR)" \
		--out "$(ZERO5_C42_OUT)"

zero-data-build: $(ZERO_DATA_OUT)/manifest.json

$(ZERO_DATA_OUT)/manifest.json: bpe_tokenizer
	node scripts/build_zero_corpus.mjs --out "$(ZERO_DATA_OUT)"

zero-data-pipeline-check: bpe_tokenizer
	node scripts/check_zero_data_pipeline.mjs

sero-corpus-plan-check:
	node scripts/check_sero_corpus_acquisition.mjs

sero-corpus-prepare: $(SERO_CORPUS_WORK)/source-registry.json

$(SERO_CORPUS_WORK)/source-registry.json: \
		corpus/registry/sero-pretrain-v1-acquisition.json \
		scripts/prepare_sero_corpus.py
	python3 scripts/prepare_sero_corpus.py --work "$(SERO_CORPUS_WORK)"

sero-corpus-build: $(SERO_CORPUS_OUT)/manifest.json

$(SERO_CORPUS_OUT)/manifest.json: bpe_tokenizer $(SERO_CORPUS_WORK)/source-registry.json
	node scripts/build_zero_corpus.mjs \
		--registry "$(SERO_CORPUS_WORK)/source-registry.json" \
		--out "$(SERO_CORPUS_OUT)"

sero-corpus-result-check: $(SERO_CORPUS_OUT)/manifest.json
	node scripts/check_sero_corpus_result.mjs --build "$(SERO_CORPUS_OUT)"

sero-latent-v1-check:
	$(SERO_LATENT_PYTHON) experiments/sero-latent-v1/train.py --self-test
	$(SERO_LATENT_PYTHON) experiments/sero-latent-v1/conventional_control.py --self-test

sero-latent-v1-pilot: $(ZERO_DATA_OUT)/manifest.json
	$(SERO_LATENT_PYTHON) experiments/sero-latent-v1/train.py \
		--train '$(ZERO_DATA_OUT)/text/train/*.txt' \
		--validation '$(ZERO_DATA_OUT)/text/validation/*.txt'

sero-latent-v1-conventional:
	$(SERO_LATENT_PYTHON) experiments/sero-latent-v1/conventional_control.py \
		--train '$(ZERO_DATA_OUT)/text/train/*.txt' \
		--validation '$(ZERO_DATA_OUT)/text/validation/*.txt'

sero-latent-v1-result-check:
	node scripts/check_sero_latent_v1_result.mjs

sero-latent-v2-check:
	$(SERO_LATENT_PYTHON) experiments/sero-latent-v2/train.py --self-test

sero-latent-v2-run: $(ZERO_DATA_OUT)/manifest.json
	$(SERO_LATENT_PYTHON) experiments/sero-latent-v2/train.py \
		--train '$(ZERO_DATA_OUT)/text/train/*.txt' \
		--validation '$(ZERO_DATA_OUT)/text/validation/*.txt' --seed 0
	$(SERO_LATENT_PYTHON) experiments/sero-latent-v2/train.py \
		--train '$(ZERO_DATA_OUT)/text/train/*.txt' \
		--validation '$(ZERO_DATA_OUT)/text/validation/*.txt' --seed 1
	$(SERO_LATENT_PYTHON) experiments/sero-latent-v2/train.py \
		--train '$(ZERO_DATA_OUT)/text/train/*.txt' \
		--validation '$(ZERO_DATA_OUT)/text/validation/*.txt' --seed 2
	$(MAKE) sero-latent-v2-result-check

sero-latent-v2-result-check:
	node scripts/check_sero_latent_v2_result.mjs

sero-latent-v3-contract-check:
	node scripts/check_sero_latent_v3_contract.mjs

sero-latent-v3-check: $(ZERO_DATA_OUT)/manifest.json sero-latent-v3-contract-check
	$(SERO_LATENT_V3_PYTHON) experiments/sero-latent-v3/tests.py \
		--manifest "$(ZERO_DATA_OUT)/manifest.json"

sero-latent-v3-smoke: $(ZERO_DATA_OUT)/manifest.json sero-latent-v3-contract-check
	$(SERO_LATENT_V3_PYTHON) experiments/sero-latent-v3/train.py \
		--manifest "$(ZERO_DATA_OUT)/manifest.json" \
		--output build/sero-latent-v3/smoke-result.json \
		--artifact-dir build/sero-latent-v3/smoke-artifacts \
		--budgets 512,1024 --context 32 --batch-size 2 \
		--tokenizer-training-bytes 8192 --vocab-size 384 \
		--validation-byte-limit 2048 --device cpu --tiny --allow-small-corpus

sero-latent-v3-run: $(SERO_LATENT_V3_MANIFEST) sero-latent-v3-contract-check
	$(SERO_LATENT_V3_PYTHON) experiments/sero-latent-v3/train.py \
		--manifest "$(SERO_LATENT_V3_MANIFEST)" \
		--output benchmarks/sero-latent-v3/seed0.json \
		--artifact-dir build/sero-latent-v3/seed0 --seed 0
	$(SERO_LATENT_V3_PYTHON) experiments/sero-latent-v3/train.py \
		--manifest "$(SERO_LATENT_V3_MANIFEST)" \
		--output benchmarks/sero-latent-v3/seed1.json \
		--artifact-dir build/sero-latent-v3/seed1 --seed 1
	$(SERO_LATENT_V3_PYTHON) experiments/sero-latent-v3/train.py \
		--manifest "$(SERO_LATENT_V3_MANIFEST)" \
		--output benchmarks/sero-latent-v3/seed2.json \
		--artifact-dir build/sero-latent-v3/seed2 --seed 2
	$(SERO_LATENT_V3_PYTHON) experiments/sero-latent-v3/aggregate.py \
		--contract benchmarks/sero-latent-v3/contract.json \
		--results benchmarks/sero-latent-v3/seed0.json \
			benchmarks/sero-latent-v3/seed1.json \
			benchmarks/sero-latent-v3/seed2.json \
		--output benchmarks/sero-latent-v3/aggregate.json
	$(MAKE) sero-latent-v3-result-check

sero-latent-v3-result-check:
	node scripts/check_sero_latent_v3_result.mjs

sero-latent-v3-aws-check:
	node scripts/check_sero_latent_v3_aws.mjs

sero1-tokenizer-lock:
	node scripts/promote_sero1_tokenizer.mjs

sero1-tokenizer-check:
	node scripts/promote_sero1_tokenizer.mjs --check

sero1-pretrain-contract-check:
	node scripts/check_sero1_pretrain_contract.mjs

sero1-pretrain-check: $(SERO1_PRETRAIN_MANIFEST) sero1-pretrain-contract-check
	$(SERO1_PRETRAIN_PYTHON) experiments/sero1-pretrain/tests.py \
		--manifest "$(SERO1_PRETRAIN_MANIFEST)"

sero1-pretrain-result-check:
	node scripts/check_sero1_pretrain_result.mjs

sero1-pretrain-aws-check:
	node scripts/check_sero1_pretrain_aws.mjs

sero1-generation-eval-result-check:
	node scripts/check_sero1_generation_eval_result.mjs

sero1-optimized-contract-check:
	node scripts/check_sero1_optimized_contract.mjs

sero1-optimized-check: sero1-optimized-contract-check
	$(SERO1_PRETRAIN_PYTHON) experiments/sero1-optimized/tests.py \
		--manifest "$(SERO1_OPTIMIZED_MANIFEST)"

sero2-curriculum-contract-check:
	node scripts/check_sero2_curriculum_contract.mjs

sero2-curriculum-check: sero2-curriculum-contract-check
	$(SERO1_PRETRAIN_PYTHON) experiments/sero2-curriculum/tests.py \
		--manifest "$(SERO2_CURRICULUM_MANIFEST)"

sero2-curriculum-result-check:
	node scripts/check_sero2_curriculum_result.mjs

sero2-curriculum-replication-contract-check:
	node scripts/check_sero2_curriculum_replication_contract.mjs

sero2-curriculum-consolidation-replication-contract-check:
	node scripts/check_sero2_curriculum_consolidation_replication_contract.mjs

sero2-curriculum-consolidation-replication-result-check:
	node scripts/check_sero2_curriculum_consolidation_replication_result.mjs

sero20m-curriculum-contract-check:
	node scripts/check_sero20m_curriculum_contract.mjs

sero20m-consolidation-contract-check:
	node scripts/check_sero20m_consolidation_contract.mjs

sero-series-closure-check:
	node scripts/check_sero_series_closure.mjs

sero20m-scale-generation-contract-check:
	node scripts/check_sero20m_scale_generation_contract.mjs

zero_lm: zero_lm.c zero1_protocol.h
	$(CC) $(CFLAGS) zero_lm.c -o $@ -lm

literary_lm: literary_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) literary_lm.c -o $@ $(LITERARY_LDLIBS)

zero5_lm: zero5_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) zero5_lm.c -o $@ $(LITERARY_LDLIBS)

zero5_c2_lm: zero5_c2_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) zero5_c2_lm.c -o $@ $(LITERARY_LDLIBS)

zero5_c3_lm: zero5_c3_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) zero5_c3_lm.c -o $@ $(LITERARY_LDLIBS)

zero5_c31_lm: zero5_c31_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) zero5_c31_lm.c -o $@ $(LITERARY_LDLIBS)

zero5_c32_lm: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) \
		zero5_c32_lm.c -o $@ $(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_fast: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(ZERO5_THREAD_FLAGS) \
		$(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ $(LITERARY_LDLIBS) \
		$(ZERO5_THREAD_FLAGS)

zero5_c32_lm_profile: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) -DUSE_PHASE_PROFILE \
		$(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_vector_tanh: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(GNU_LIBMVEC_CFLAGS) \
		-DUSE_LIBMVEC_TANH $(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) \
		zero5_c32_lm.c -o $@ $(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_vector_exp: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(GNU_LIBMVEC_CFLAGS) \
		-DUSE_LIBMVEC_EXP $(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) \
		zero5_c32_lm.c -o $@ $(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_vector_math: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(GNU_LIBMVEC_CFLAGS) \
		-DUSE_LIBMVEC_TANH -DUSE_LIBMVEC_EXP $(ZERO5_THREAD_FLAGS) \
		$(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ $(LITERARY_LDLIBS) \
		$(ZERO5_THREAD_FLAGS)

zero5_c51_target_lm: zero5_c51_target_lm.c zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(GNU_LIBMVEC_CFLAGS) \
		-DUSE_LIBMVEC_TANH -DUSE_LIBMVEC_EXP $(ZERO5_THREAD_FLAGS) \
		$(LITERARY_CFLAGS) zero5_c51_target_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c61_bottleneck_lm: zero5_c61_bottleneck_lm.c zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(GNU_LIBMVEC_CFLAGS) \
		-DUSE_LIBMVEC_TANH -DUSE_LIBMVEC_EXP $(ZERO5_THREAD_FLAGS) \
		$(LITERARY_CFLAGS) zero5_c61_bottleneck_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_attention_b32: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(GNU_LIBMVEC_CFLAGS) \
		-DUSE_LIBMVEC_TANH -DUSE_LIBMVEC_EXP \
		-DUSE_BLOCKED_CAUSAL_ATTENTION -DATTENTION_QUERY_BLOCK=32 \
		$(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_attention_b64: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(GNU_LIBMVEC_CFLAGS) \
		-DUSE_LIBMVEC_TANH -DUSE_LIBMVEC_EXP \
		-DUSE_BLOCKED_CAUSAL_ATTENTION -DATTENTION_QUERY_BLOCK=64 \
		$(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_attention_b128: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) $(GNU_LIBMVEC_CFLAGS) \
		-DUSE_LIBMVEC_TANH -DUSE_LIBMVEC_EXP \
		-DUSE_BLOCKED_CAUSAL_ATTENTION -DATTENTION_QUERY_BLOCK=128 \
		$(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_qkv_forward: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) -DUSE_FUSED_QKV_FORWARD \
		$(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_qkv_backward: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) -DUSE_FUSED_QKV_BACKWARD \
		$(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_qkv: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) -DUSE_FUSED_QKV_FORWARD \
		-DUSE_FUSED_QKV_BACKWARD $(ZERO5_THREAD_FLAGS) \
		$(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ $(LITERARY_LDLIBS) \
		$(ZERO5_THREAD_FLAGS)

zero5_c32_lm_tensor: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) -DUSE_TENSOR_BATCH \
		$(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5_c32_lm_tensor_qkv: zero5_c32_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(CPU_FAST_CFLAGS) -DUSE_TENSOR_BATCH \
		-DUSE_FUSED_QKV_FORWARD -DUSE_FUSED_QKV_BACKWARD \
		$(ZERO5_THREAD_FLAGS) $(LITERARY_CFLAGS) zero5_c32_lm.c -o $@ \
		$(LITERARY_LDLIBS) $(ZERO5_THREAD_FLAGS)

zero5-cpu-speed-check: zero5_c32_lm zero5_c32_lm_fast
	./zero5_c32_lm --self-test
	./zero5_c32_lm_fast --self-test
	node scripts/benchmark_zero5_cpu.mjs --self-test

zero5-cpu-speed-v2-check: zero5-cpu-speed-check
	node scripts/check_zero5_cpu_speed_v2.mjs

zero5-cpu-profile-check: zero5_c32_lm zero5_c32_lm_fast \
		zero5_c32_lm_profile
	./zero5_c32_lm_profile --self-test
	ZERO5_PROFILE_BINARY=./zero5_c32_lm_profile \
		node scripts/check_zero5_c32.mjs
	node scripts/benchmark_zero5_profile.mjs --self-test

zero5-cpu-profile-aws-check:
	bash -n scripts/aws/zero5-cpu-profile-run-instance.sh
	bash -n scripts/aws/zero5-cpu-profile-user-data.sh
	node scripts/check_zero5_cpu_profile_aws.mjs

zero5-cpu-profile-aws-result-check: zero5-cpu-profile-aws-check
	node scripts/check_zero5_cpu_profile_aws_result.mjs

zero5-vector-math-check: zero5_c32_lm zero5_c32_lm_fast \
		zero5_c32_lm_vector_tanh zero5_c32_lm_vector_exp \
		zero5_c32_lm_vector_math
	./zero5_c32_lm_vector_tanh --self-test
	./zero5_c32_lm_vector_exp --self-test
	./zero5_c32_lm_vector_math --self-test
	ZERO5_VECTOR_BINARY=./zero5_c32_lm_vector_math \
		node scripts/check_zero5_c32.mjs
	node scripts/benchmark_zero5_vector_math.mjs --self-test

zero5-vector-math-aws-check:
	bash -n scripts/aws/zero5-vector-math-run-instance.sh
	bash -n scripts/aws/zero5-vector-math-user-data.sh
	node scripts/check_zero5_vector_math_aws.mjs

zero5-vector-math-aws-result-check: zero5-vector-math-aws-check
	node scripts/check_zero5_vector_math_aws_result.mjs

zero5-vector-validation-check: zero5-vector-math-check
	node scripts/benchmark_zero5_vector_validation.mjs --self-test

zero5-vector-validation-aws-check: zero5-vector-validation-check
	bash -n scripts/aws/zero5-vector-validation-user-data.sh
	bash -n scripts/aws/zero5-vector-validation-run-instance.sh
	node scripts/check_zero5_vector_validation_aws.mjs

zero5-vector-validation-aws-result-check: zero5-vector-validation-aws-check
	node scripts/check_zero5_vector_validation_aws_result.mjs

zero5-blocked-attention-check: zero5-vector-math-check \
		zero5_c32_lm_attention_b32 zero5_c32_lm_attention_b64 \
		zero5_c32_lm_attention_b128
	./zero5_c32_lm_attention_b32 --self-test
	./zero5_c32_lm_attention_b64 --self-test
	./zero5_c32_lm_attention_b128 --self-test
	ZERO5_VECTOR_BINARY=./zero5_c32_lm_vector_math \
		ZERO5_ATTENTION_BINARY=./zero5_c32_lm_attention_b64 \
		node scripts/check_zero5_c32.mjs
	node scripts/benchmark_zero5_blocked_attention.mjs --self-test

zero5-qkv-fusion-check: zero5_c32_lm_fast zero5_c32_lm_qkv_forward \
		zero5_c32_lm_qkv_backward zero5_c32_lm_qkv
	./zero5_c32_lm_qkv_forward --self-test
	./zero5_c32_lm_qkv_backward --self-test
	./zero5_c32_lm_qkv --self-test
	node scripts/benchmark_zero5_qkv.mjs --self-test
	node scripts/check_zero5_qkv_result.mjs

zero5-tensor-batch-check: zero5_c32_lm_tensor zero5_c32_lm_tensor_qkv
	./zero5_c32_lm_tensor --self-test
	./zero5_c32_lm_tensor_qkv --self-test
	ZERO5_TENSOR_BINARY=./zero5_c32_lm_tensor \
		node scripts/check_zero5_c32.mjs
	ZERO5_TENSOR_BINARY=./zero5_c32_lm_tensor_qkv \
		node scripts/check_zero5_c32.mjs
	node scripts/benchmark_zero5_tensor.mjs --self-test

zero5-tensor-aws-check:
	bash -n scripts/aws/zero5-tensor-calibration-run-instance.sh
	bash -n scripts/aws/zero5-tensor-calibration-user-data.sh
	node scripts/check_zero5_tensor_aws.mjs

zero5-tensor-aws-result-check: zero5-tensor-aws-check
	node scripts/check_zero5_tensor_aws_result.mjs

graded_plasticity_audit: graded_plasticity_audit.c literary_lm.c \
		channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) graded_plasticity_audit.c -o $@ \
		$(LITERARY_LDLIBS)

graded_plasticity_pilot: graded_plasticity_pilot.c \
		graded_plasticity_audit.c literary_lm.c channel_protocol.h \
		zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) graded_plasticity_pilot.c -o $@ \
		$(LITERARY_LDLIBS)

conservative_exposure_pilot: conservative_exposure_pilot.c \
		graded_plasticity_audit.c literary_lm.c channel_protocol.h \
		zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) conservative_exposure_pilot.c -o $@ \
		$(LITERARY_LDLIBS)

quantity_adapter_pilot: quantity_adapter_pilot.c \
		graded_plasticity_audit.c literary_lm.c channel_protocol.h \
		zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) quantity_adapter_pilot.c -o $@ \
		$(LITERARY_LDLIBS)

package_quantity_adapter: package_quantity_adapter.c
	$(CC) $(CFLAGS) package_quantity_adapter.c -o $@

quantity_adapter_infer: quantity_adapter_infer.c literary_infer.c \
		literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) quantity_adapter_infer.c -o $@ -lm

base_probability_infer: base_probability_infer.c literary_infer.c \
		literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) base_probability_infer.c -o $@ -lm

quantity_adapter_request_eval: quantity_request_eval.c \
		quantity_adapter_infer.c literary_infer.c literary_infer.h \
		faculty_controller.c faculty_protocol.h quantity_oracle.c \
		quantity_oracle.h channel_protocol.h
	$(CC) $(CFLAGS) -DQUANTITY_ADAPTER_INFER_NO_MAIN \
		-DFACULTY_CONTROLLER_NO_MAIN quantity_request_eval.c \
		quantity_adapter_infer.c faculty_controller.c quantity_oracle.c \
		-o $@ -lm

zero4-q30-check: quantity_adapter_pilot literary_infer export_literary \
		package_quantity_adapter quantity_adapter_infer \
		quantity_adapter_request_eval base_probability_infer zero4-q22-data \
		corpus/bpe/.zero3.stamp channel-data
	node scripts/check_zero4_q30.mjs

operation_head_pilot: operation_head_pilot.c literary_lm.c \
		channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) operation_head_pilot.c -o $@ \
		$(LITERARY_LDLIBS)

package_operation_head: package_operation_head.c
	$(CC) $(CFLAGS) package_operation_head.c -o $@

operation_head_infer: operation_head_infer.c literary_infer.c \
		literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) operation_head_infer.c -o $@ -lm

operation_head_request_eval: quantity_request_eval.c \
		operation_head_infer.c literary_infer.c literary_infer.h \
		faculty_controller.c faculty_protocol.h quantity_oracle.c \
		quantity_oracle.h channel_protocol.h
	$(CC) $(CFLAGS) -DOPERATION_HEAD_INFER_NO_MAIN \
		-DFACULTY_CONTROLLER_NO_MAIN quantity_request_eval.c \
		operation_head_infer.c faculty_controller.c quantity_oracle.c \
		-o $@ -lm

semantic_operation_eval: semantic_operation_eval.c operation_head_infer.c \
		literary_infer.c literary_infer.h faculty_controller.c \
		faculty_protocol.h quantity_oracle.c quantity_oracle.h channel_protocol.h
	$(CC) $(CFLAGS) -DFACULTY_CONTROLLER_NO_MAIN semantic_operation_eval.c \
		faculty_controller.c quantity_oracle.c -o $@ -lm

semantic_runtime_head_pilot: semantic_runtime_head_pilot.c \
		runtime_operation_head_pilot.c operation_head_infer.c literary_infer.c \
		literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) semantic_runtime_head_pilot.c -o $@ -lm

runtime_operation_head_pilot: runtime_operation_head_pilot.c \
		operation_head_infer.c literary_infer.c literary_infer.h \
		channel_protocol.h
	$(CC) $(CFLAGS) runtime_operation_head_pilot.c -o $@ -lm

package_runtime_operation_head: package_runtime_operation_head.c
	$(CC) $(CFLAGS) package_runtime_operation_head.c -o $@

zero4-q31-check: operation_head_pilot package_operation_head \
		operation_head_infer operation_head_request_eval \
		base_probability_infer zero4-q22-data
	node scripts/check_zero4_q31.mjs

zero4-q32-check: runtime_operation_head_pilot package_runtime_operation_head \
		operation_head_infer operation_head_request_eval base_probability_infer \
		zero4-q22-data
	node scripts/check_zero4_q32.mjs

zero4-q32-result-check:
	node scripts/check_zero4_q32_result.mjs

zero4-q32-public-check: operation_head_infer operation_head_request_eval \
		base_probability_infer zero4-q22-data
	node scripts/check_zero4_q32_public.mjs

zero4-q32-public-result-check:
	node scripts/check_zero4_q32_public_result.mjs

zero4-q32-promotion-check: operation_head_infer operation_head_request_eval \
		base_probability_infer zero4-q22-data
	node scripts/check_zero4_q32_promotion.mjs

zero4-q32-promotion-result-check:
	node scripts/check_zero4_q32_promotion_result.mjs

zero4-q33-semantic-check: semantic_operation_eval \
		runtime_operation_head_pilot package_runtime_operation_head \
		operation_head_infer base_probability_infer zero4-q22-data
	node scripts/check_zero4_q33_semantic.mjs

zero4-q33-semantic-result-check:
	node scripts/check_zero4_q33_semantic_result.mjs

zero4-q34-semantic-head-check: semantic_runtime_head_pilot \
		package_runtime_operation_head semantic_operation_eval \
		operation_head_request_eval operation_head_infer base_probability_infer \
		zero4-q22-data
	node scripts/check_zero4_q34_semantic_head.mjs

zero4-q34-semantic-head-result-check:
	node scripts/check_zero4_q34_semantic_head_result.mjs

bpe_tokenizer: bpe_tokenizer.c
	$(CC) $(CFLAGS) bpe_tokenizer.c -o $@

logic_corpus: logic_corpus.c
	$(CC) $(CFLAGS) logic_corpus.c -o $@

brainfuck_corpus: brainfuck_corpus.c channel_protocol.h
	$(CC) $(CFLAGS) brainfuck_corpus.c -o $@

channel_corpus: channel_corpus.c channel_protocol.h
	$(CC) $(CFLAGS) channel_corpus.c -o $@

faculty_controller: faculty_controller.c faculty_protocol.h quantity_oracle.c quantity_oracle.h
	$(CC) $(CFLAGS) faculty_controller.c quantity_oracle.c -o $@ -lm

export_literary: export_literary.c
	$(CC) $(CFLAGS) export_literary.c -o $@ -lm

freeze_literary_teacher: freeze_literary_teacher.c
	$(CC) $(CFLAGS) freeze_literary_teacher.c -o $@

literary_infer: literary_infer.c literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) literary_infer.c -o $@ -lm

memorization_eval: memorization_eval.c literary_infer.c literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) -DLITERARY_INFER_NO_MAIN \
		memorization_eval.c literary_infer.c -o $@ -lm

zero_eval: zero_eval.c literary_infer.c literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) -DLITERARY_INFER_NO_MAIN zero_eval.c literary_infer.c -o $@ -lm

faculty_eval: faculty_eval.c literary_infer.c literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) -DLITERARY_INFER_NO_MAIN faculty_eval.c literary_infer.c -o $@ -lm

quantity_request_eval: quantity_request_eval.c literary_infer.c literary_infer.h faculty_controller.c faculty_protocol.h quantity_oracle.c quantity_oracle.h channel_protocol.h
	$(CC) $(CFLAGS) -DLITERARY_INFER_NO_MAIN -DFACULTY_CONTROLLER_NO_MAIN quantity_request_eval.c literary_infer.c faculty_controller.c quantity_oracle.c -o $@ -lm

external_eval: external_eval.c literary_infer.c literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) -DLITERARY_INFER_NO_MAIN \
		external_eval.c literary_infer.c -o $@ $(LITERARY_LDLIBS)

external-eval-check: external_eval
	node scripts/prepare_zero_eval1.mjs --self-test
	node scripts/sample_zero_eval1_calibration.mjs --self-test
	node scripts/check_zero_eval1.mjs --self-test
	node scripts/check_zero_eval1.mjs --mechanics ./external_eval

quantity-request-eval-check: quantity_request_eval scripts/generate_zero4_q2.mjs
	test -f docs/model.litq8
	rm -rf /tmp/zero-quantity-eval-check
	node scripts/generate_zero4_q2.mjs \
		--out /tmp/zero-quantity-eval-check --quantity 100 --seed 5 \
		--request-mode operation >/dev/null
	./quantity_request_eval docs/model.litq8 \
		/tmp/zero-quantity-eval-check/quantity-request.sentinel.tsv \
		--json /tmp/zero-quantity-serial.json --limit 4 --jobs 1 >/dev/null
	./quantity_request_eval docs/model.litq8 \
		/tmp/zero-quantity-eval-check/quantity-request.sentinel.tsv \
		--json /tmp/zero-quantity-parallel.json --jobs 2 --limit 4 >/dev/null
	cmp /tmp/zero-quantity-serial.json /tmp/zero-quantity-parallel.json
	! ZERO_QUANTITY_JOBS=invalid ./quantity_request_eval docs/model.litq8 \
		/tmp/zero-quantity-eval-check/quantity-request.sentinel.tsv \
		--json /tmp/zero-quantity-invalid.json --limit 1 >/dev/null 2>&1

corpus-rights-check:
	node scripts/check_corpus_rights.mjs

zero4-memorization-check: memorization_eval corpus/bpe/.zero3.stamp \
		channel-data zero4-q22-data
	node scripts/run_zero4_memorization.mjs
	node scripts/check_corpus_rights.mjs

huggingface-release-stage: corpus-rights-check
	node scripts/stage_huggingface_release.mjs --out $(HF_OUT)

corpus/literary.bpe corpus/bpe/shakespeare.tok corpus/bpe/blake.tok corpus/bpe/crowley.tok: bpe_tokenizer corpus/shakespeare.txt corpus/blake.txt corpus/crowley.txt
	mkdir -p corpus/bpe
	./bpe_tokenizer --vocab corpus/literary.bpe \
		--text corpus/shakespeare.txt --out corpus/bpe/shakespeare.tok \
		--text corpus/blake.txt --out corpus/bpe/blake.tok \
		--text corpus/crowley.txt --out corpus/bpe/crowley.tok

corpus/channel/literary-dialogue.tok: channel_corpus corpus/bpe/shakespeare.tok corpus/bpe/blake.tok corpus/bpe/crowley.tok
	mkdir -p corpus/channel
	./channel_corpus \
		--play S corpus/bpe/shakespeare.tok \
		--play C corpus/bpe/crowley.tok \
		--verse B corpus/bpe/blake.tok \
		--out $@ --preview corpus/channel/PREVIEW.txt

channel-data: corpus/channel/literary-dialogue.tok

corpus/raw/bible-kjv-gutenberg-30.txt:
	mkdir -p corpus/raw
	curl -L --fail --silent --show-error $(KJV_URL) -o $@.tmp
	mv $@.tmp $@

corpus/bible-kjv.txt: corpus/raw/bible-kjv-gutenberg-30.txt scripts/prepare_kjv.sh
	sh scripts/prepare_kjv.sh $< $@

zero1-teacher.ckpt: zero_lm
	./zero_lm --steps 20000 --tokens 0 --seed 0 --save $@

corpus/bpe/.zero3.stamp: bpe_tokenizer corpus/zero-foundation.txt \
		corpus/shakespeare.txt corpus/blake.txt corpus/crowley.txt \
		corpus/bible-kjv.txt
	mkdir -p corpus/bpe
	./bpe_tokenizer --vocab corpus/literary.bpe \
		--text corpus/zero-foundation.txt --out corpus/bpe/zero-foundation.tok \
		--text corpus/shakespeare.txt --out corpus/bpe/shakespeare.tok \
		--text corpus/blake.txt --out corpus/bpe/blake.tok \
		--text corpus/crowley.txt --out corpus/bpe/crowley.tok \
		--text corpus/bible-kjv.txt --out corpus/bpe/bible-kjv.tok
	touch $@

zero3-data: zero1-teacher.ckpt corpus/bpe/.zero3.stamp channel-data

zero3-stage1: literary_lm zero3-data
	test -f $(ZERO2_CHECKPOINT)
	./literary_lm \
		--resume $(ZERO2_CHECKPOINT) \
		--teacher $(ZERO2_CHECKPOINT) --teacher-weight 0.15 \
		--zero1-teacher zero1-teacher.ckpt --zero1-weight 0.25 \
		--tokenizer corpus/literary.bpe \
		--foundation corpus/bpe/zero-foundation.tok --foundation-weight 2 \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --channel-weight 6 \
		--steps $(ZERO3_STEPS) --batch 2 --lr 0.00003 \
		--warmup 200 --dropout 0.08 --cosine \
		--report 100 --validation 24 --patience 30 \
		--best zero3.ckpt --save zero3-last.ckpt --save-every 500 \
		--tokens 0

zero3-consolidate: literary_lm zero3-data
	test -f zero3.ckpt
	./literary_lm \
		--resume zero3.ckpt \
		--teacher $(ZERO2_CHECKPOINT) --teacher-weight 0.35 \
		--zero1-teacher zero1-teacher.ckpt --zero1-weight 0.15 \
		--tokenizer corpus/literary.bpe \
		--foundation corpus/bpe/zero-foundation.tok --foundation-weight 2 \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --channel-weight 6 \
		--steps $(ZERO3_CONSOLIDATION_STEPS) --batch 2 --lr 0.00001 \
		--warmup 100 --dropout 0.05 --cosine \
		--report 100 --validation 24 --patience 12 \
		--best zero3-consolidated.ckpt \
		--save zero3-consolidated-last.ckpt --save-every 500 \
		--tokens 0

zero3-balance: literary_lm zero3-data
	test -f zero3-consolidated.ckpt
	./literary_lm \
		--resume zero3-consolidated.ckpt \
		--teacher $(ZERO2_CHECKPOINT) --teacher-weight 0.50 \
		--zero1-teacher zero1-teacher.ckpt --zero1-weight 0.10 \
		--tokenizer corpus/literary.bpe \
		--foundation corpus/bpe/zero-foundation.tok --foundation-weight 2 \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --channel-weight 6 \
		--steps $(ZERO3_BALANCE_STEPS) --batch 2 --lr 0.000003 \
		--warmup 50 --dropout 0.03 --cosine \
		--report 100 --validation 24 \
		--best zero3-balanced.ckpt --save zero3-balanced-last.ckpt \
		--tokens 0

zero3-train: zero3-stage1
	$(MAKE) zero3-consolidate
	$(MAKE) zero3-balance

docs/model.litq8: $(ZERO4_PROMOTED_ARTIFACT)
	cp $(ZERO4_PROMOTED_ARTIFACT) $@

docs/literary.js: literary_infer.c literary_infer.h channel_protocol.h
	$(EMCC) literary_infer.c -O3 -msimd128 --no-entry \
		-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node \
		-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 \
		-sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
		-sEXPORTED_FUNCTIONS='["_malloc","_free","_lm_load","_lm_reset","_lm_seed","_lm_feed","_lm_sample","_lm_probability","_lm_get_context","_lm_get_position","_lm_get_update","_lm_get_parameters","_lm_holo_reset","_lm_holo_set_mode","_lm_holo_get_mode","_lm_holo_remember","_lm_holo_recall","_lm_holo_get_score","_lm_holo_get_count"]' \
		-o docs/literary.js

docs/literary.wasm: docs/literary.js
	@if [ ! -s $@ ]; then $(MAKE) -B docs/literary.js; fi
	test -s $@

web: docs/model.litq8 docs/literary.js docs/literary.wasm

zero-benchmark: zero_eval $(ZERO_CHANNEL_MODEL) benchmarks/zero-channel-v1/manifest.json
	mkdir -p benchmarks/zero-channel-v1/results
	./zero_eval $(ZERO_CHANNEL_MODEL) \
		benchmarks/zero-channel-v1/cases.tsv \
		benchmarks/zero-channel-v1/holo.tsv \
		--json benchmarks/zero-channel-v1/results/baseline.json
	node scripts/render_zero_results.mjs \
		benchmarks/zero-channel-v1/manifest.json \
		benchmarks/zero-channel-v1/results/baseline.json \
		benchmarks/zero-channel-v1/results/BASELINE.md

zero-benchmark-check: zero_eval
	./zero_eval --self-test
	node scripts/render_zero_results.mjs --check \
		benchmarks/zero-channel-v1/manifest.json \
		benchmarks/zero-channel-v1/results/baseline.json \
		benchmarks/zero-channel-v1/results/BASELINE.md

zero4-faculty-data: scripts/generate_zero4_faculty.mjs
	mkdir -p corpus/faculty/generated
	node scripts/generate_zero4_faculty.mjs \
		--out corpus/faculty/generated \
		--quantity 10000 --geometry 10000 --art 5000 --protocol 3000 --seed 4

zero4-faculty-check: faculty_controller zero4-faculty-data
	./faculty_controller --self-test
	node scripts/generate_zero4_faculty.mjs --check \
		--out corpus/faculty/generated

zero4-smoke: literary_lm zero4-faculty-check
	test -f teachers/zero3-balanced-final.teacher
	./literary_lm --init teachers/zero3-balanced-final.teacher \
		--tokenizer corpus/literary.bpe \
		--text corpus/bpe/zero-foundation.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--channel corpus/channel/literary-dialogue.tok --channel-weight 3 \
		--hard-channel corpus/faculty/generated/quantity.tok --sample-weight 3 \
		--hard-channel corpus/faculty/generated/geometry.tok --sample-weight 3 \
		--hard-channel corpus/faculty/generated/art.tok --sample-weight 3 \
		--hard-channel corpus/faculty/generated/protocol.tok --sample-weight 2 \
		--steps 20 --batch 1 --lr 0.000003 --warmup 5 --dropout 0.03 \
		--report 10 --validation 32 \
		--best /tmp/zero4-smoke-best.ckpt \
		--save /tmp/zero4-smoke-last.ckpt --tokens 0
	./literary_lm --resume /tmp/zero4-smoke-best.ckpt --eval-only \
		--tokenizer corpus/literary.bpe \
		--channel corpus/faculty/generated/quantity.tok \
		--channel corpus/faculty/generated/geometry.tok \
		--channel corpus/faculty/generated/art.tok --validation 30

zero4-q1-train: literary_lm corpus/bpe/.zero3.stamp channel-data \
		zero4-faculty-check
	test -f teachers/zero3-balanced-final.teacher
	./literary_lm --init teachers/zero3-balanced-final.teacher \
		--teacher teachers/zero3-balanced-final.teacher --teacher-weight 0.50 \
		--tokenizer corpus/literary.bpe \
		--text corpus/bpe/zero-foundation.tok --sample-weight 1 \
		--text corpus/bpe/shakespeare.tok --sample-weight 1 \
		--text corpus/bpe/blake.tok --sample-weight 1 \
		--text corpus/bpe/crowley.tok --sample-weight 1 \
		--text corpus/bpe/bible-kjv.tok --sample-weight 1 \
		--channel corpus/channel/literary-dialogue.tok --sample-weight 1 \
		--hard-channel corpus/faculty/generated/quantity.tok --sample-weight 34 \
		--artifact-weight 4 \
		--steps $(ZERO4_Q1_STEPS) --batch $(ZERO4_Q1_BATCH) \
		--lr 0.00002 --warmup 100 --dropout 0.02 --cosine \
		--report 100 --validation 56 --patience 12 --seed $(ZERO4_Q1_SEED) \
		--best $(ZERO4_Q1_PREFIX)-best.ckpt \
		--save $(ZERO4_Q1_PREFIX)-last.ckpt --save-every 500 --tokens 0

zero4-q1-eval: literary_lm faculty_eval export_literary
	test -f $(ZERO4_Q1_PREFIX)-best.ckpt
	mkdir -p $(ZERO4_Q1_RESULTS)
	./export_literary $(ZERO4_Q1_PREFIX)-best.ckpt \
		$(ZERO4_Q1_PREFIX)-best.litq8
	./faculty_eval $(ZERO4_Q1_PREFIX)-best.litq8 \
		corpus/faculty/generated/quantity.promotion.tsv \
		--quantity-json $(ZERO4_Q1_RESULTS)/seed1-raw.json
	./faculty_eval $(ZERO4_Q1_PREFIX)-best.litq8 \
		corpus/faculty/generated/quantity.promotion.tsv \
		--quantity-constrained-json \
		$(ZERO4_Q1_RESULTS)/seed1-constrained.json
	./literary_lm --init teachers/zero3-balanced-final.teacher --eval-only \
		--tokenizer corpus/literary.bpe \
		--text corpus/bpe/zero-foundation.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --validation 48 \
		| tee $(ZERO4_Q1_RESULTS)/zero3-replay-baseline.log
	./literary_lm --resume $(ZERO4_Q1_PREFIX)-best.ckpt --eval-only \
		--tokenizer corpus/literary.bpe \
		--text corpus/bpe/zero-foundation.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --validation 48 \
		| tee $(ZERO4_Q1_RESULTS)/seed1-replay.log
	node scripts/evaluate_zero4_q1.mjs \
		--raw $(ZERO4_Q1_RESULTS)/seed1-raw.json \
		--constrained $(ZERO4_Q1_RESULTS)/seed1-constrained.json \
		--baseline $(ZERO4_Q1_RESULTS)/zero3-replay-baseline.log \
		--replay $(ZERO4_Q1_RESULTS)/seed1-replay.log \
		--model $(ZERO4_Q1_PREFIX)-best.litq8 \
		--out $(ZERO4_Q1_RESULTS)

zero4-q1: zero4-q1-train
	$(MAKE) zero4-q1-eval

zero4-q2-data: scripts/generate_zero4_q2.mjs
	mkdir -p corpus/faculty/q2
	node scripts/generate_zero4_q2.mjs --out corpus/faculty/q2 \
		--quantity 10000 --seed 5

zero4-q2-check: faculty_controller quantity_request_eval zero4-q2-data
	./faculty_controller --self-test
	node scripts/generate_zero4_q2.mjs --check --out corpus/faculty/q2

zero4-q2-train: literary_lm corpus/bpe/.zero3.stamp channel-data \
		zero4-q2-check
	test -f teachers/zero1-foundation.teacher
	test -f teachers/zero2-literary.teacher
	test -f teachers/zero3-balanced-final.teacher
	./literary_lm --init teachers/zero3-balanced-final.teacher \
		--teacher teachers/zero2-literary.teacher --teacher-weight 0.20 \
		--teacher teachers/zero3-balanced-final.teacher --teacher-weight 0.20 \
		--zero1-teacher teachers/zero1-foundation.teacher --zero1-weight 0.25 \
		--tokenizer corpus/literary.bpe \
		--foundation corpus/bpe/zero-foundation.tok --sample-weight 1 \
			--distill 0.25,0.05,0.10 \
		--text corpus/bpe/shakespeare.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/blake.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/crowley.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/bible-kjv.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--channel corpus/channel/literary-dialogue.tok --sample-weight 1 \
			--distill 0,0.10,0.20 \
		--hard-channel corpus/faculty/q2/quantity-request.tok --sample-weight 9 \
		--steps $(ZERO4_Q2_STEPS) --batch $(ZERO4_Q2_BATCH) \
		--lr 0.00002 --warmup 100 --dropout 0.02 --cosine \
		--report 100 --validation 56 --patience 10 --seed $(ZERO4_Q2_SEED) \
		--best $(ZERO4_Q2_PREFIX)-best.ckpt \
		--save $(ZERO4_Q2_PREFIX)-last.ckpt --save-every 500 --tokens 0

zero4-q2-eval: literary_lm quantity_request_eval export_literary
	test -f $(ZERO4_Q2_PREFIX)-best.ckpt
	mkdir -p $(ZERO4_Q2_RESULTS)
	./export_literary $(ZERO4_Q2_PREFIX)-best.ckpt \
		$(ZERO4_Q2_PREFIX)-best.litq8
	./quantity_request_eval $(ZERO4_Q2_PREFIX)-best.litq8 \
		corpus/faculty/q2/quantity-request.promotion.tsv \
		--json $(ZERO4_Q2_RESULTS)/seed$(ZERO4_Q2_SEED)-requests.json \
		--limit $(ZERO4_Q2_EVAL_LIMIT)
	./literary_lm --init teachers/zero3-balanced-final.teacher --eval-only \
		--tokenizer corpus/literary.bpe \
		--text corpus/bpe/zero-foundation.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --validation 48 \
		| tee $(ZERO4_Q2_RESULTS)/zero3-replay-baseline.log
	./literary_lm --resume $(ZERO4_Q2_PREFIX)-best.ckpt --eval-only \
		--tokenizer corpus/literary.bpe \
		--text corpus/bpe/zero-foundation.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --validation 48 \
		| tee $(ZERO4_Q2_RESULTS)/seed$(ZERO4_Q2_SEED)-replay.log
	node scripts/evaluate_zero4_q2.mjs \
		--requests $(ZERO4_Q2_RESULTS)/seed$(ZERO4_Q2_SEED)-requests.json \
		--baseline $(ZERO4_Q2_RESULTS)/zero3-replay-baseline.log \
		--replay $(ZERO4_Q2_RESULTS)/seed$(ZERO4_Q2_SEED)-replay.log \
		--model $(ZERO4_Q2_PREFIX)-best.litq8 \
		--steps $(ZERO4_Q2_STEPS) --seed $(ZERO4_Q2_SEED) \
		--out $(ZERO4_Q2_RESULTS)

zero4-q2: zero4-q2-train
	$(MAKE) zero4-q2-eval ZERO4_Q2_STEPS=$(ZERO4_Q2_STEPS) \
		ZERO4_Q2_BATCH=$(ZERO4_Q2_BATCH) ZERO4_Q2_SEED=$(ZERO4_Q2_SEED) \
		ZERO4_Q2_PREFIX=$(ZERO4_Q2_PREFIX) ZERO4_Q2_RESULTS=$(ZERO4_Q2_RESULTS) \
		ZERO4_Q2_EVAL_LIMIT=$(ZERO4_Q2_EVAL_LIMIT)

zero4-q21-data: scripts/generate_zero4_q2.mjs
	mkdir -p corpus/faculty/q21
	node scripts/generate_zero4_q2.mjs --out corpus/faculty/q21 \
		--quantity 10000 --seed 5 --request-mode operation

zero4-q21-check: faculty_controller quantity_request_eval zero4-q21-data
	./faculty_controller --self-test
	node scripts/generate_zero4_q2.mjs --check --out corpus/faculty/q21

zero4-q21-train: literary_lm corpus/bpe/.zero3.stamp channel-data \
		zero4-q21-check
	test -f teachers/zero1-foundation.teacher
	test -f teachers/zero2-literary.teacher
	test -f teachers/zero3-balanced-final.teacher
	./literary_lm --init teachers/zero3-balanced-final.teacher \
		--teacher teachers/zero2-literary.teacher --teacher-weight 0.20 \
		--teacher teachers/zero3-balanced-final.teacher --teacher-weight 0.20 \
		--zero1-teacher teachers/zero1-foundation.teacher --zero1-weight 0.25 \
		--tokenizer corpus/literary.bpe \
		--foundation corpus/bpe/zero-foundation.tok --sample-weight 1 \
			--distill 0.25,0.05,0.10 \
		--text corpus/bpe/shakespeare.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/blake.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/crowley.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/bible-kjv.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--channel corpus/channel/literary-dialogue.tok --sample-weight 1 \
			--distill 0,0.10,0.20 \
		--hard-channel corpus/faculty/q21/quantity-request.tok --sample-weight 4 \
		--steps $(ZERO4_Q21_STEPS) --batch $(ZERO4_Q21_BATCH) \
		--lr 0.00002 --warmup 100 --dropout 0.02 --cosine \
		--report 100 --validation 56 --patience 10 --seed $(ZERO4_Q21_SEED) \
		--best $(ZERO4_Q21_PREFIX)-best.ckpt \
		--save $(ZERO4_Q21_PREFIX)-last.ckpt --save-every 500 --tokens 0

zero4-q21-consolidate: literary_lm corpus/bpe/.zero3.stamp channel-data \
		zero4-q21-check
	test -f $(ZERO4_Q21_PREFIX)-best.ckpt
	./literary_lm --resume $(ZERO4_Q21_PREFIX)-best.ckpt \
		--teacher teachers/zero2-literary.teacher --teacher-weight 0.20 \
		--teacher teachers/zero3-balanced-final.teacher --teacher-weight 0.20 \
		--zero1-teacher teachers/zero1-foundation.teacher --zero1-weight 0.25 \
		--tokenizer corpus/literary.bpe \
		--foundation corpus/bpe/zero-foundation.tok --sample-weight 1 \
			--distill 0.25,0.05,0.10 \
		--text corpus/bpe/shakespeare.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/blake.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/crowley.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--text corpus/bpe/bible-kjv.tok --sample-weight 1 \
			--distill 0,0.20,0.15 \
		--channel corpus/channel/literary-dialogue.tok --sample-weight 1 \
			--distill 0,0.10,0.20 \
		--hard-channel corpus/faculty/q21/quantity-request.tok --sample-weight 2 \
		--steps $(ZERO4_Q21_CONSOLIDATION_STEPS) --batch $(ZERO4_Q21_BATCH) \
		--lr 0.000005 --warmup 50 --dropout 0.01 --cosine \
		--report 100 --validation 56 --patience 4 --seed $(ZERO4_Q21_SEED) \
		--best $(ZERO4_Q21_FINAL_PREFIX)-best.ckpt \
		--save $(ZERO4_Q21_FINAL_PREFIX)-last.ckpt --tokens 0

zero4-q21-eval: literary_lm quantity_request_eval export_literary
	test -f $(ZERO4_Q21_PREFIX)-best.ckpt
	mkdir -p $(ZERO4_Q21_RESULTS)
	./export_literary $(ZERO4_Q21_PREFIX)-best.ckpt \
		$(ZERO4_Q21_PREFIX)-best.litq8
	./quantity_request_eval $(ZERO4_Q21_PREFIX)-best.litq8 \
		corpus/faculty/q21/quantity-request.promotion.tsv \
		--json $(ZERO4_Q21_RESULTS)/seed$(ZERO4_Q21_SEED)-requests.json \
		--limit $(ZERO4_Q21_EVAL_LIMIT)
	./literary_lm --init teachers/zero3-balanced-final.teacher --eval-only \
		--tokenizer corpus/literary.bpe \
		--text corpus/bpe/zero-foundation.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --validation 48 \
		| tee $(ZERO4_Q21_RESULTS)/zero3-replay-baseline.log
	./literary_lm --resume $(ZERO4_Q21_PREFIX)-best.ckpt --eval-only \
		--tokenizer corpus/literary.bpe \
		--text corpus/bpe/zero-foundation.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok \
		--text corpus/bpe/bible-kjv.tok \
		--channel corpus/channel/literary-dialogue.tok --validation 48 \
		| tee $(ZERO4_Q21_RESULTS)/seed$(ZERO4_Q21_SEED)-replay.log
	node scripts/evaluate_zero4_q2.mjs \
		--requests $(ZERO4_Q21_RESULTS)/seed$(ZERO4_Q21_SEED)-requests.json \
		--baseline $(ZERO4_Q21_RESULTS)/zero3-replay-baseline.log \
		--replay $(ZERO4_Q21_RESULTS)/seed$(ZERO4_Q21_SEED)-replay.log \
		--model $(ZERO4_Q21_PREFIX)-best.litq8 \
		--steps $(ZERO4_Q21_STEPS) --seed $(ZERO4_Q21_SEED) \
		--experiment q21 --mode operation --request-share 0.40 \
		--consolidation-share 0.25 \
		--out $(ZERO4_Q21_RESULTS)

zero4-q21: zero4-q21-train
	$(MAKE) zero4-q21-consolidate ZERO4_Q21_PREFIX=$(ZERO4_Q21_PREFIX) \
		ZERO4_Q21_FINAL_PREFIX=$(ZERO4_Q21_FINAL_PREFIX)
	$(MAKE) zero4-q21-eval \
		ZERO4_Q21_STEPS=$(ZERO4_Q21_TOTAL_STEPS) \
		ZERO4_Q21_BATCH=$(ZERO4_Q21_BATCH) ZERO4_Q21_SEED=$(ZERO4_Q21_SEED) \
		ZERO4_Q21_PREFIX=$(ZERO4_Q21_FINAL_PREFIX) \
		ZERO4_Q21_RESULTS=$(ZERO4_Q21_RESULTS) \
		ZERO4_Q21_EVAL_LIMIT=$(ZERO4_Q21_EVAL_LIMIT)

zero4-q22-data: scripts/generate_zero4_q2.mjs \
		scripts/materialize_zero4_q22_shared_task.mjs
	mkdir -p corpus/faculty/q22
	node scripts/generate_zero4_q2.mjs --out corpus/faculty/q22 \
		--quantity 10000 --seed 5 --request-mode operation
	node scripts/materialize_zero4_q22_shared_task.mjs corpus/faculty/q22

zero4-q22-shared-task-check: scripts/generate_zero4_q2.mjs \
		scripts/materialize_zero4_q22_shared_task.mjs \
		scripts/check_zero4_q22_shared_task.mjs \
		benchmarks/zero4-q22-shared-task-v1/manifest.json
	rm -rf /tmp/zero4-q22-shared-task-v1
	node scripts/generate_zero4_q2.mjs --out /tmp/zero4-q22-shared-task-v1 \
		--quantity 10000 --seed 5 --request-mode operation
	node scripts/materialize_zero4_q22_shared_task.mjs \
		/tmp/zero4-q22-shared-task-v1
	node scripts/check_zero4_q22_shared_task.mjs \
		benchmarks/zero4-q22-shared-task-v1/manifest.json \
		/tmp/zero4-q22-shared-task-v1

zero4-q22-compositional-shared-task-check: \
		scripts/generate_q22_compositional_routing.mjs \
		scripts/check_q22_compositional_shared_task.mjs \
		benchmarks/zero4-q22-compositional-shared-task-v1/manifest.json
	rm -rf /tmp/zero4-q22-compositional-shared-task-v1
	node scripts/generate_q22_compositional_routing.mjs \
		--out /tmp/zero4-q22-compositional-shared-task-v1 \
		--train 10000 --eval 1000 --seed 23
	node scripts/generate_q22_compositional_routing.mjs \
		--check --out /tmp/zero4-q22-compositional-shared-task-v1
	node scripts/check_q22_compositional_shared_task.mjs \
		benchmarks/zero4-q22-compositional-shared-task-v1/manifest.json \
		/tmp/zero4-q22-compositional-shared-task-v1

zero4-q22-check: faculty_controller quantity_request_eval zero4-q22-data \
		scripts/train_zero4_q22.mjs
	./faculty_controller --self-test
	node scripts/generate_zero4_q2.mjs --check --out corpus/faculty/q22
	node scripts/train_zero4_q22.mjs --self-test

zero4-q22-train: literary_lm export_literary corpus/bpe/.zero3.stamp \
		channel-data zero4-q22-check
	test -f teachers/zero1-foundation.teacher
	test -f teachers/zero2-literary.teacher
	test -f teachers/zero3-balanced-final.teacher
	node scripts/train_zero4_q22.mjs \
		--prefix $(ZERO4_Q22_PREFIX) --out $(ZERO4_Q22_RESULTS) \
		--data corpus/faculty/q22 --experiment $(ZERO4_Q22_EXPERIMENT) \
		--steps $(ZERO4_Q22_STEPS) \
		--consolidation-steps $(ZERO4_Q22_CONSOLIDATION_STEPS) \
		--batch $(ZERO4_Q22_BATCH) --seed $(ZERO4_Q22_SEED) \
		--chunk 25 --full-every 100 \
		--sentinel-replay-batches 12 --full-replay-batches 48

zero4-q22-eval: scripts/evaluate_zero4_q2.mjs
	test -f $(ZERO4_Q22_RESULTS)/selection.json
	test -f $(ZERO4_Q22_RESULTS)/seed$(ZERO4_Q22_SEED)-promotion.json
	test -f $(ZERO4_Q22_RESULTS)/seed$(ZERO4_Q22_SEED)-selected-replay.log
	test -f $(ZERO4_Q22_RESULTS)/selected.litq8
	node scripts/evaluate_zero4_q2.mjs \
		--requests $(ZERO4_Q22_RESULTS)/seed$(ZERO4_Q22_SEED)-promotion.json \
		--baseline $(ZERO4_Q22_RESULTS)/replay-baseline.log \
		--replay $(ZERO4_Q22_RESULTS)/seed$(ZERO4_Q22_SEED)-selected-replay.log \
		--model $(ZERO4_Q22_RESULTS)/selected.litq8 \
		--steps $(ZERO4_Q22_TOTAL_STEPS) --seed $(ZERO4_Q22_SEED) \
		--experiment $(ZERO4_Q22_EXPERIMENT) --mode operation --request-share 0.40 \
		--consolidation-share 0.25 \
		--selection $(ZERO4_Q22_RESULTS)/selection.json \
		--out $(ZERO4_Q22_RESULTS)

zero4-q22: zero4-q22-train
	$(MAKE) zero4-q22-eval \
		ZERO4_Q22_TOTAL_STEPS=$(ZERO4_Q22_TOTAL_STEPS) \
		ZERO4_Q22_SEED=$(ZERO4_Q22_SEED) \
		ZERO4_Q22_EXPERIMENT=$(ZERO4_Q22_EXPERIMENT) \
		ZERO4_Q22_PREFIX=$(ZERO4_Q22_PREFIX) \
		ZERO4_Q22_RESULTS=$(ZERO4_Q22_RESULTS)

zero4-q22r-check: literary_lm export_literary quantity_request_eval \
		scripts/train_zero4_q22r.mjs
	test -f $(ZERO4_Q22R_SOURCE)
	test -f corpus/faculty/q22/quantity-request.sentinel.tsv
	test -f corpus/faculty/q22/quantity-request.public.tsv
	test -f corpus/faculty/q22/quantity-request.promotion.tsv
	node scripts/train_zero4_q22r.mjs --self-test

zero4-q22r-train: zero4-q22r-check
	node scripts/train_zero4_q22r.mjs \
		--q22-selection $(ZERO4_Q22R_SOURCE) \
		--prefix $(ZERO4_Q22R_PREFIX) --out $(ZERO4_Q22R_RESULTS) \
		--data corpus/faculty/q22 --starts $(ZERO4_Q22R_STARTS) \
		--steps $(ZERO4_Q22R_STEPS) --chunk 25 --full-every 50 \
		--batch $(ZERO4_Q22R_BATCH) --seed $(ZERO4_Q22R_SEED) \
		--learning-rate 0.000001 \
		--sentinel-replay-batches 12 --full-replay-batches 48

zero4-q22r-eval: scripts/evaluate_zero4_q2.mjs
	test -f $(ZERO4_Q22R_RESULTS)/selection.json
	test -f $(ZERO4_Q22R_RESULTS)/seed$(ZERO4_Q22R_SEED)-promotion.json
	test -f $(ZERO4_Q22R_RESULTS)/seed$(ZERO4_Q22R_SEED)-selected-replay.log
	test -f $(ZERO4_Q22R_RESULTS)/selected.litq8
	node scripts/evaluate_zero4_q2.mjs \
		--requests $(ZERO4_Q22R_RESULTS)/seed$(ZERO4_Q22R_SEED)-promotion.json \
		--baseline $(ZERO4_Q22R_RESULTS)/replay-baseline.log \
		--replay $(ZERO4_Q22R_RESULTS)/seed$(ZERO4_Q22R_SEED)-selected-replay.log \
		--model $(ZERO4_Q22R_RESULTS)/selected.litq8 \
		--steps $(ZERO4_Q22R_STEPS) --seed $(ZERO4_Q22R_SEED) \
		--experiment q22r --mode operation --request-share 0 \
		--selection $(ZERO4_Q22R_RESULTS)/selection.json \
		--out $(ZERO4_Q22R_RESULTS)

zero4-q22r: zero4-q22r-train
	$(MAKE) zero4-q22r-eval \
		ZERO4_Q22R_STEPS=$(ZERO4_Q22R_STEPS) \
		ZERO4_Q22R_SEED=$(ZERO4_Q22R_SEED) \
		ZERO4_Q22R_PREFIX=$(ZERO4_Q22R_PREFIX) \
		ZERO4_Q22R_RESULTS=$(ZERO4_Q22R_RESULTS)

zero4-q23-check: literary_lm channel_corpus freeze_literary_teacher \
		scripts/check_zero4_q23.mjs scripts/train_zero4_q23.mjs \
		benchmarks/zero4-q23-v1/contract.json \
		tests/fixtures/q23-channel.tsv
	rm -f /tmp/q23-ci-observer.jsonl /tmp/q23-ci-guard.jsonl \
		/tmp/q23-ci-resume-full.jsonl /tmp/q23-ci-resume-chunk.jsonl
	node scripts/check_zero4_q23.mjs --self-test
	node scripts/train_zero4_q23.mjs --self-test
	./literary_lm --context 256 --dim 16 --heads 2 --layers 1 --ff 32 \
		--text corpus/zero-foundation.txt --steps 1 --batch 1 \
		--report 1 --validation 1 --seed 5 --save /tmp/q23-ci-init.ckpt \
		--tokens 0 >/dev/null
	./freeze_literary_teacher /tmp/q23-ci-init.ckpt \
		/tmp/q23-ci.teacher >/dev/null
	./channel_corpus --chat H tests/fixtures/q23-channel.tsv \
		--out /tmp/q23-ci-channel.tok >/dev/null
	./literary_lm --init /tmp/q23-ci.teacher \
		--teacher /tmp/q23-ci.teacher --teacher-weight 0.15 \
		--text corpus/zero-foundation.txt \
		--hard-channel /tmp/q23-ci-channel.tok --sample-weight 2 \
		--steps 2 --batch 1 --lr 0.001 --warmup 1 --dropout 0.02 \
		--cosine --schedule-total 2 --report 2 --validation 2 --seed 77 \
		--save /tmp/q23-ci-disabled.ckpt --tokens 0 >/dev/null
	./literary_lm --init /tmp/q23-ci.teacher \
		--teacher /tmp/q23-ci.teacher --teacher-weight 0.15 \
		--text corpus/zero-foundation.txt \
		--hard-channel /tmp/q23-ci-channel.tok --sample-weight 2 \
		--steps 2 --batch 1 --lr 0.001 --warmup 1 --dropout 0.02 \
		--cosine --schedule-total 2 --report 2 --validation 2 --seed 77 \
		--save /tmp/q23-ci-observer.ckpt --transaction-mode observer \
		--transaction-log /tmp/q23-ci-observer.jsonl \
		--transaction-phase smoke --transaction-probe 1 --tokens 0 >/dev/null
	cmp -i 80:80 /tmp/q23-ci-disabled.ckpt /tmp/q23-ci-observer.ckpt
	node scripts/check_zero4_q23.mjs benchmarks/zero4-q23-v1/contract.json \
		/tmp/q23-ci-observer.jsonl
	./literary_lm --init /tmp/q23-ci.teacher \
		--teacher /tmp/q23-ci.teacher --teacher-weight 0.15 \
		--text corpus/zero-foundation.txt \
		--hard-channel /tmp/q23-ci-channel.tok --sample-weight 100 \
		--steps 2 --batch 1 --lr 0.1 --warmup 0 --dropout 0 \
		--report 1 --validation 2 --seed 77 --save /tmp/q23-ci-guard.ckpt \
		--transaction-mode guard --transaction-log /tmp/q23-ci-guard.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0 --transaction-max-rejections 1 \
		--tokens 0 >/dev/null
	node scripts/check_zero4_q23.mjs benchmarks/zero4-q23-v1/contract.json \
		/tmp/q23-ci-guard.jsonl --require-rejection
	./literary_lm --init /tmp/q23-ci.teacher \
		--teacher /tmp/q23-ci.teacher --teacher-weight 0.15 \
		--text corpus/zero-foundation.txt \
		--hard-channel /tmp/q23-ci-channel.tok --sample-weight 100 \
		--steps 6 --batch 1 --lr 0.1 --warmup 0 --dropout 0 --cosine \
		--schedule-total 6 --report 100 --validation 2 --seed 77 \
		--save /tmp/q23-ci-resume-full.ckpt --transaction-mode guard \
		--transaction-log /tmp/q23-ci-resume-full.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	./literary_lm --init /tmp/q23-ci.teacher \
		--teacher /tmp/q23-ci.teacher --teacher-weight 0.15 \
		--text corpus/zero-foundation.txt \
		--hard-channel /tmp/q23-ci-channel.tok --sample-weight 100 \
		--steps 3 --batch 1 --lr 0.1 --warmup 0 --dropout 0 --cosine \
		--schedule-total 6 --report 100 --validation 2 --seed 77 \
		--save /tmp/q23-ci-resume-chunk.ckpt --transaction-mode guard \
		--transaction-log /tmp/q23-ci-resume-chunk.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	./literary_lm --resume /tmp/q23-ci-resume-chunk.ckpt \
		--teacher /tmp/q23-ci.teacher --teacher-weight 0.15 \
		--text corpus/zero-foundation.txt \
		--hard-channel /tmp/q23-ci-channel.tok --sample-weight 100 \
		--steps 3 --batch 1 --lr 0.1 --warmup 0 --dropout 0 --cosine \
		--schedule-offset 3 --schedule-total 6 --report 100 \
		--validation 2 --seed 77 --save /tmp/q23-ci-resume-chunk.ckpt \
		--transaction-mode guard \
		--transaction-log /tmp/q23-ci-resume-chunk.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	cmp /tmp/q23-ci-resume-full.ckpt /tmp/q23-ci-resume-chunk.ckpt
	node scripts/check_zero4_q23.mjs benchmarks/zero4-q23-v1/contract.json \
		/tmp/q23-ci-resume-full.jsonl --require-mixed

zero4-q23-observer: literary_lm export_literary quantity_request_eval \
		zero4-q23-check zero4-q22-data corpus/bpe/.zero3.stamp channel-data \
		scripts/train_zero4_q23.mjs
	test -f teachers/zero1-foundation.teacher
	test -f teachers/zero2-literary.teacher
	test -f teachers/zero3-balanced-final.teacher
	node scripts/train_zero4_q23.mjs --stage observer \
		--prefix $(ZERO4_Q23_OBSERVER_PREFIX) \
		--out $(ZERO4_Q23_OBSERVER_RESULTS) --data corpus/faculty/q22 \
		--steps 1000 --consolidation-steps 400 --batch 2 \
		--seed $(ZERO4_Q23_SEED) --recovery-every 25 --full-every 100 \
		--sentinel-replay-batches 12 --full-replay-batches 48

zero4-q23-train: literary_lm export_literary quantity_request_eval \
		zero4-q23-check zero4-q22-data corpus/bpe/.zero3.stamp channel-data \
		scripts/train_zero4_q23.mjs
	test -f $(ZERO4_Q23_OBSERVER_RESULTS)/result.json
	node scripts/train_zero4_q23.mjs --stage guard \
		--prefix $(ZERO4_Q23_PREFIX) --out $(ZERO4_Q23_RESULTS) \
		--data corpus/faculty/q22 \
		--observer-result $(ZERO4_Q23_OBSERVER_RESULTS)/result.json \
		--steps 1000 --consolidation-steps 400 --batch 2 \
		--seed $(ZERO4_Q23_SEED) --recovery-every 25 --full-every 100 \
		--sentinel-replay-batches 12 --full-replay-batches 48

zero4-q23: zero4-q23-observer
	$(MAKE) zero4-q23-train \
		ZERO4_Q23_SEED=$(ZERO4_Q23_SEED) \
		ZERO4_Q23_PREFIX=$(ZERO4_Q23_PREFIX) \
		ZERO4_Q23_RESULTS=$(ZERO4_Q23_RESULTS) \
		ZERO4_Q23_OBSERVER_RESULTS=$(ZERO4_Q23_OBSERVER_RESULTS)

zero4-q24-check: literary_lm channel_corpus freeze_literary_teacher \
		scripts/check_zero4_q24.mjs scripts/train_zero4_q24.mjs \
		benchmarks/zero4-q24-v1/contract.json \
		tests/fixtures/q23-channel.tsv
	rm -f /tmp/q24-ci-full.jsonl /tmp/q24-ci-chunk.jsonl \
		/tmp/q24-ci-full.ckpt /tmp/q24-ci-chunk.ckpt
	node scripts/check_zero4_q24.mjs --self-test
	node scripts/train_zero4_q24.mjs --self-test
	./literary_lm --context 256 --dim 16 --heads 2 --layers 1 --ff 32 \
		--text corpus/zero-foundation.txt --steps 1 --batch 1 \
		--report 1 --validation 1 --seed 5 --save /tmp/q24-ci-init.ckpt \
		--tokens 0 >/dev/null
	./freeze_literary_teacher /tmp/q24-ci-init.ckpt \
		/tmp/q24-ci.teacher >/dev/null
	./channel_corpus --chat H tests/fixtures/q23-channel.tsv \
		--out /tmp/q24-ci-channel.tok >/dev/null
	./literary_lm --init /tmp/q24-ci.teacher \
		--teacher /tmp/q24-ci.teacher --teacher-weight 0.15 \
		$(Q24_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q24-ci-channel.tok --sample-weight 100 \
		--steps 8 --batch 1 --lr 0.1 --warmup 0 --dropout 0 --cosine \
		--schedule-total 8 --report 100 --validation 7 --seed 77 \
		--save /tmp/q24-ci-full.ckpt \
		--transaction-mode cumulative-guard \
		--transaction-log /tmp/q24-ci-full.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	./literary_lm --init /tmp/q24-ci.teacher \
		--teacher /tmp/q24-ci.teacher --teacher-weight 0.15 \
		$(Q24_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q24-ci-channel.tok --sample-weight 100 \
		--steps 4 --batch 1 --lr 0.1 --warmup 0 --dropout 0 --cosine \
		--schedule-total 8 --report 100 --validation 7 --seed 77 \
		--save /tmp/q24-ci-chunk.ckpt \
		--transaction-mode cumulative-guard \
		--transaction-log /tmp/q24-ci-chunk.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	./literary_lm --resume /tmp/q24-ci-chunk.ckpt \
		--teacher /tmp/q24-ci.teacher --teacher-weight 0.15 \
		$(Q24_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q24-ci-channel.tok --sample-weight 100 \
		--steps 4 --batch 1 --lr 0.1 --warmup 0 --dropout 0 --cosine \
		--schedule-offset 4 --schedule-total 8 --report 100 \
		--validation 7 --seed 77 --save /tmp/q24-ci-chunk.ckpt \
		--transaction-mode cumulative-guard \
		--transaction-log /tmp/q24-ci-chunk.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	cmp /tmp/q24-ci-full.ckpt /tmp/q24-ci-chunk.ckpt
	cmp /tmp/q24-ci-full.jsonl /tmp/q24-ci-chunk.jsonl
	node scripts/check_zero4_q24.mjs \
		benchmarks/zero4-q24-v1/contract.json /tmp/q24-ci-full.jsonl \
		--require-rejection --require-acceptance

zero4-q24-train: literary_lm export_literary quantity_request_eval \
		zero4-q24-check zero4-q22-data corpus/bpe/.zero3.stamp channel-data \
		scripts/train_zero4_q24.mjs
	node scripts/train_zero4_q24.mjs \
		--prefix $(ZERO4_Q24_PREFIX) --out $(ZERO4_Q24_RESULTS) \
		--data corpus/faculty/q22 \
		--steps 1000 --consolidation-steps 400 --batch 2 \
		--seed $(ZERO4_Q24_SEED) --recovery-every 25 --full-every 100 \
		--sentinel-replay-batches 12 --full-replay-batches 48

zero4-q24: zero4-q24-train

zero4-q25-check: literary_lm channel_corpus freeze_literary_teacher \
		scripts/check_zero4_q25.mjs scripts/train_zero4_q25.mjs \
		benchmarks/zero4-q25-v1/contract.json \
		tests/fixtures/q23-channel.tsv
	rm -f /tmp/q25-ci-full.jsonl /tmp/q25-ci-chunk.jsonl \
		/tmp/q25-ci-full.ckpt /tmp/q25-ci-chunk.ckpt
	./literary_lm --self-test >/dev/null
	node scripts/check_zero4_q25.mjs --self-test
	node scripts/train_zero4_q25.mjs --self-test
	./literary_lm --context 256 --dim 8 --heads 2 --layers 1 --ff 16 \
		--text corpus/zero-foundation.txt --steps 1 --batch 1 \
		--report 1 --validation 1 --seed 5 --save /tmp/q25-ci-init.ckpt \
		--tokens 0 >/dev/null
	./freeze_literary_teacher /tmp/q25-ci-init.ckpt \
		/tmp/q25-ci.teacher >/dev/null
	./channel_corpus --chat H tests/fixtures/q23-channel.tsv \
		--out /tmp/q25-ci-channel.tok >/dev/null
	./literary_lm --init /tmp/q25-ci.teacher \
		--teacher /tmp/q25-ci.teacher --teacher-weight 0.15 \
		$(Q25_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q25-ci-channel.tok --sample-weight 100 \
		--steps 8 --batch 1 --lr 1 --warmup 0 --dropout 0 --cosine \
		--schedule-total 8 --report 100 --validation 1 --seed 77 \
		--save /tmp/q25-ci-full.ckpt \
		--transaction-mode cumulative-backtracking \
		--transaction-log /tmp/q25-ci-full.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	./literary_lm --init /tmp/q25-ci.teacher \
		--teacher /tmp/q25-ci.teacher --teacher-weight 0.15 \
		$(Q25_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q25-ci-channel.tok --sample-weight 100 \
		--steps 4 --batch 1 --lr 1 --warmup 0 --dropout 0 --cosine \
		--schedule-total 8 --report 100 --validation 1 --seed 77 \
		--save /tmp/q25-ci-chunk.ckpt \
		--transaction-mode cumulative-backtracking \
		--transaction-log /tmp/q25-ci-chunk.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	./literary_lm --resume /tmp/q25-ci-chunk.ckpt \
		--teacher /tmp/q25-ci.teacher --teacher-weight 0.15 \
		$(Q25_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q25-ci-channel.tok --sample-weight 100 \
		--steps 4 --batch 1 --lr 1 --warmup 0 --dropout 0 --cosine \
		--schedule-offset 4 --schedule-total 8 --report 100 \
		--validation 1 --seed 77 --save /tmp/q25-ci-chunk.ckpt \
		--transaction-mode cumulative-backtracking \
		--transaction-log /tmp/q25-ci-chunk.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	cmp /tmp/q25-ci-full.ckpt /tmp/q25-ci-chunk.ckpt
	cmp /tmp/q25-ci-full.jsonl /tmp/q25-ci-chunk.jsonl
	node scripts/check_zero4_q25.mjs \
		benchmarks/zero4-q25-v1/contract.json /tmp/q25-ci-full.jsonl \
		--require-backtrack --require-full-scale

zero4-q25-train: literary_lm export_literary quantity_request_eval \
		zero4-q25-check zero4-q22-data corpus/bpe/.zero3.stamp channel-data \
		scripts/train_zero4_q25.mjs
	node scripts/train_zero4_q25.mjs \
		--prefix $(ZERO4_Q25_PREFIX) --out $(ZERO4_Q25_RESULTS) \
		--data corpus/faculty/q22 \
		--steps 1000 --consolidation-steps 400 --batch 2 \
		--seed $(ZERO4_Q25_SEED) --recovery-every 25 --full-every 100 \
		--sentinel-replay-batches 12 --full-replay-batches 48

zero4-q25: zero4-q25-train

zero4-q26-check: literary_lm channel_corpus freeze_literary_teacher \
		scripts/check_zero4_q26.mjs scripts/train_zero4_q26.mjs \
		benchmarks/zero4-q26-v1/contract.json \
		tests/fixtures/q23-channel.tsv
	rm -f /tmp/q26-ci-full.jsonl /tmp/q26-ci-chunk.jsonl \
		/tmp/q26-ci-full.ckpt /tmp/q26-ci-chunk.ckpt
	./literary_lm --self-test >/dev/null
	node scripts/check_zero4_q26.mjs --self-test
	node scripts/train_zero4_q26.mjs --self-test
	./literary_lm --context 256 --dim 8 --heads 2 --layers 1 --ff 16 \
		--text corpus/zero-foundation.txt --steps 1 --batch 1 \
		--report 1 --validation 1 --seed 5 --save /tmp/q26-ci-init.ckpt \
		--tokens 0 >/dev/null
	./freeze_literary_teacher /tmp/q26-ci-init.ckpt \
		/tmp/q26-ci.teacher >/dev/null
	./channel_corpus --chat H tests/fixtures/q23-channel.tsv \
		--out /tmp/q26-ci-channel.tok >/dev/null
	./literary_lm --init /tmp/q26-ci.teacher \
		--teacher /tmp/q26-ci.teacher --teacher-weight 0.15 \
		$(Q26_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q26-ci-channel.tok --sample-weight 100 \
		--steps 8 --batch 1 --lr 1 --warmup 0 --dropout 0 --cosine \
		--schedule-total 8 --report 100 --validation 1 --seed 77 \
		--save /tmp/q26-ci-full.ckpt \
		--transaction-mode cumulative-tangent \
		--transaction-log /tmp/q26-ci-full.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	./literary_lm --init /tmp/q26-ci.teacher \
		--teacher /tmp/q26-ci.teacher --teacher-weight 0.15 \
		$(Q26_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q26-ci-channel.tok --sample-weight 100 \
		--steps 4 --batch 1 --lr 1 --warmup 0 --dropout 0 --cosine \
		--schedule-total 8 --report 100 --validation 1 --seed 77 \
		--save /tmp/q26-ci-chunk.ckpt \
		--transaction-mode cumulative-tangent \
		--transaction-log /tmp/q26-ci-chunk.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	./literary_lm --resume /tmp/q26-ci-chunk.ckpt \
		--teacher /tmp/q26-ci.teacher --teacher-weight 0.15 \
		$(Q26_CI_REPLAY_ARGS) \
		--hard-channel /tmp/q26-ci-channel.tok --sample-weight 100 \
		--steps 4 --batch 1 --lr 1 --warmup 0 --dropout 0 --cosine \
		--schedule-offset 4 --schedule-total 8 --report 100 \
		--validation 1 --seed 77 --save /tmp/q26-ci-chunk.ckpt \
		--transaction-mode cumulative-tangent \
		--transaction-log /tmp/q26-ci-chunk.jsonl \
		--transaction-phase smoke --transaction-probe 1 \
		--transaction-budget 0.015 --transaction-max-rejections 8 \
		--tokens 0 >/dev/null
	cmp /tmp/q26-ci-full.ckpt /tmp/q26-ci-chunk.ckpt
	cmp /tmp/q26-ci-full.jsonl /tmp/q26-ci-chunk.jsonl
	node scripts/check_zero4_q26.mjs \
		benchmarks/zero4-q26-v1/contract.json /tmp/q26-ci-full.jsonl \
		--require-backtrack --require-full-scale

zero4-q26-train: literary_lm export_literary quantity_request_eval \
		zero4-q26-check zero4-q22-data corpus/bpe/.zero3.stamp channel-data \
		scripts/train_zero4_q26.mjs
	node scripts/train_zero4_q26.mjs \
		--prefix $(ZERO4_Q26_PREFIX) --out $(ZERO4_Q26_RESULTS) \
		--data corpus/faculty/q22 \
		--steps 1000 --consolidation-steps 400 --batch 2 \
		--seed $(ZERO4_Q26_SEED) --recovery-every 25 --full-every 100 \
		--sentinel-replay-batches 12 --full-replay-batches 48

zero4-q26: zero4-q26-train

experiment-evidence-check: scripts/check_experiment_evidence.mjs \
		scripts/check_literature_review.mjs \
		benchmarks/zero4-q27-v1/EVIDENCE.json \
		benchmarks/zero4-q27-v1/DESIGN-REVISION.json \
		benchmarks/zero4-q27-v1/LITERATURE-REVIEW.json
	node scripts/check_experiment_evidence.mjs --self-test
	node scripts/check_experiment_evidence.mjs \
		benchmarks/zero4-q27-v1/EVIDENCE.json

literature-review-pipeline-check: scripts/check_literature_review.mjs \
		scripts/run_experiment_literature_review.mjs \
		schemas/literature-review-result.schema.json \
		benchmarks/zero4-q27-v1/EVIDENCE.json \
		benchmarks/zero4-q27-v1/LITERATURE-REVIEW.json
	node scripts/check_literature_review.mjs --self-test
	@if test -f benchmarks/zero4-q27-v1/LITERATURE-REVIEW.json; then \
		node scripts/check_literature_review.mjs \
			benchmarks/zero4-q27-v1/LITERATURE-REVIEW.json \
			benchmarks/zero4-q27-v1/EVIDENCE.json; \
	fi

literature-review-q27: literature-review-pipeline-check
	node scripts/run_experiment_literature_review.mjs

zero4-post-q27-research-check: scripts/analyze_zero4_plasticity.mjs \
		scripts/check_post_q27_research.mjs \
		benchmarks/zero4-post-q27-v1/LITERATURE-REVIEW.json \
		benchmarks/zero4-post-q27-v1/HYPOTHESES.json \
		benchmarks/zero4-post-q27-v1/trace-analysis.json
	node scripts/analyze_zero4_plasticity.mjs --self-test
	node scripts/check_post_q27_research.mjs --self-test

zero4-q28-check: graded_plasticity_audit scripts/check_zero4_q28.mjs \
		scripts/run_zero4_q28_shadow_audit.mjs \
		benchmarks/zero4-q28-v1/contract.json \
		benchmarks/zero4-q28-v1/PREREGISTRATION.md \
		benchmarks/zero4-q28-v1/AUDIT-DECISION.json \
		benchmarks/zero4-q28-v1/pilot-budget.json
	node scripts/check_zero4_q28.mjs --mechanics ./graded_plasticity_audit

zero4-q28-activation-check: graded_plasticity_pilot \
		scripts/check_zero4_q28_activation.mjs \
		scripts/run_zero4_q28_pilot.mjs \
		benchmarks/zero4-q28-v1/activation-contract.json \
		benchmarks/zero4-q28-v1/ACTIVATION.md \
		benchmarks/zero4-q28-v1/pilot-budget.json
	node scripts/check_zero4_q28_activation.mjs \
		--mechanics ./graded_plasticity_pilot

zero4-q28-language-gate-check: \
		scripts/check_zero4_q28_language_gate.mjs \
		scripts/materialize_q28_language_gate_budget.mjs \
		scripts/check_q28_language_gate_result.mjs \
		scripts/render_q28_language_gate_result.mjs \
		scripts/aws/q28-language-gate.sh \
		scripts/aws/q28-language-gate-user-data.sh \
		scripts/aws/q28-language-gate-run-instances.sh \
		benchmarks/zero4-q28-v1/language-gate/candidate-binding.json \
		benchmarks/zero4-q28-v1/language-gate/budget-template.json \
		benchmarks/zero4-q28-v1/language-gate/quantity-result.json \
		benchmarks/zero4-q28-v1/language-gate/candidate.litq8 \
		.github/workflows/q28-language-gate-launch.yml \
		.github/workflows/q28-language-gate-collect.yml
	node scripts/check_zero4_q28_language_gate.mjs

zero4-q28-u100-language-gate-check: \
		scripts/check_zero4_q28_u100_language_gate.mjs \
		scripts/materialize_q28_u100_language_gate_budget.mjs \
		scripts/check_q28_u100_language_gate_result.mjs \
		scripts/render_q28_u100_language_gate_result.mjs \
		scripts/aws/q28-u100-language-gate.sh \
		scripts/aws/q28-u100-language-gate-user-data.sh \
		scripts/aws/q28-u100-language-gate-run-instances.sh \
		benchmarks/zero4-q28-v1/update-100-language-gate/candidate-binding.json \
		benchmarks/zero4-q28-v1/update-100-language-gate/budget-template.json \
		benchmarks/zero4-q28-v1/update-100-language-gate/quantity-result.json \
		benchmarks/zero4-q28-v1/update-100-language-gate/candidate.litq8 \
		.github/workflows/q28-u100-language-gate-launch.yml \
		.github/workflows/q28-u100-language-gate-collect.yml
	node scripts/check_zero4_q28_u100_language_gate.mjs

zero4-q29-check: conservative_exposure_pilot \
		scripts/check_zero4_q29.mjs \
		scripts/check_zero4_q29_result.mjs \
		scripts/run_zero4_q29_pilot.mjs \
		scripts/materialize_q29_pilot_budget.mjs \
		benchmarks/zero4-post-q28-v1/decision.json \
		benchmarks/zero4-post-q28-v1/DECISION.md \
		benchmarks/zero4-q29-v1/contract.json \
		benchmarks/zero4-q29-v1/activation-contract.json \
		benchmarks/zero4-q29-v1/PREREGISTRATION.md \
		benchmarks/zero4-q29-v1/ACTIVATION.md \
		benchmarks/zero4-q29-v1/pilot-budget.json
	node scripts/check_zero4_q29.mjs \
		--mechanics ./conservative_exposure_pilot
	node scripts/check_zero4_q29_result.mjs

zero4-q29-language-gate-check: \
		scripts/check_zero4_q29_language_gate.mjs \
		scripts/materialize_q29_language_gate_budget.mjs \
		scripts/check_q29_language_gate_result.mjs \
		scripts/render_q29_language_gate_result.mjs \
		scripts/aws/q29-language-gate.sh \
		scripts/aws/q29-language-gate-user-data.sh \
		scripts/aws/q29-language-gate-run-instances.sh \
		benchmarks/zero4-q29-v1/language-gate/candidate-binding.json \
		benchmarks/zero4-q29-v1/language-gate/budget-template.json \
		benchmarks/zero4-q29-v1/language-gate/quantity-result.json \
		benchmarks/zero4-q29-v1/language-gate/candidate.litq8 \
		.github/workflows/q29-language-gate-launch.yml \
		.github/workflows/q29-language-gate-collect.yml
	node scripts/check_zero4_q29_language_gate.mjs

zero4-q27-check: literary_lm scripts/check_zero4_q27.mjs \
		scripts/check_experiment_evidence.mjs \
		scripts/check_q27_design_revision.mjs \
		scripts/check_q27_aws_budget.mjs \
		scripts/check_q27_aws_preflight.mjs \
		scripts/check_q27_aws_preflight_failure.mjs \
		scripts/check_q27_aws_execution_failure.mjs \
		scripts/check_q27_aws_retry.mjs \
		scripts/check_q27_preflight_iam.mjs \
		scripts/check_q27_aws_workflows.mjs \
		scripts/check_q27_aws_completion.mjs \
		scripts/check_zero4_q27_result.mjs \
		scripts/materialize_q27_language_gate_budget.mjs \
		scripts/train_zero4_q27.mjs \
		scripts/aws/q27-preflight.sh \
		scripts/aws/apply-q27-preflight-iam.sh \
		scripts/aws/q27-run-instances.sh \
		scripts/aws/q27-classify-prior-instance.sh \
		scripts/aws/q27-seed2.sh \
		scripts/aws/q27-seed2-user-data.sh \
		.github/workflows/ci.yml \
		.github/workflows/q27-aws-launch.yml \
		.github/workflows/q27-aws-infrastructure-retry.yml \
		.github/workflows/q27-aws-collect.yml \
		benchmarks/zero4-q27-v1/contract.json \
		benchmarks/zero4-q27-v1/DESIGN-REVISION.json \
		benchmarks/zero4-q27-v1/DESIGN-REVISION.md \
		benchmarks/zero4-q27-v1/EVIDENCE.json \
		benchmarks/zero4-q27-v1/LITERATURE-REVIEW.json \
		benchmarks/zero4-q27-v1/aws-v1/conditional-language-gate.json \
		benchmarks/zero4-q27-v1/aws-v1/preflight-failure-30189009274.json \
		benchmarks/zero4-q27-v1/aws-v1/execution-failure-30199981920.json \
		benchmarks/zero4-q27-v1/aws-v1/infrastructure-retry-1.json \
		benchmarks/zero4-q27-v1/aws-v1/budget.json
	rm -f /tmp/q27-scope-full.ckpt /tmp/q27-scope-chunk.ckpt
	./literary_lm --self-test >/dev/null
	node scripts/check_q27_design_revision.mjs --self-test
	node scripts/check_zero4_q27.mjs
	node scripts/materialize_q27_language_gate_budget.mjs --self-test
	node scripts/check_q27_aws_budget.mjs
	node scripts/check_q27_aws_preflight.mjs
	node scripts/check_q27_aws_preflight_failure.mjs
	node scripts/check_q27_aws_execution_failure.mjs
	node scripts/check_q27_aws_retry.mjs
	node scripts/check_q27_preflight_iam.mjs
	node scripts/check_q27_aws_workflows.mjs
	bash scripts/aws/q27-classify-prior-instance.sh --self-test
	node scripts/check_q27_aws_completion.mjs --if-present
	node scripts/train_zero4_q27.mjs --self-test
	bash -n scripts/aws/q27-seed2.sh \
		scripts/aws/q27-seed2-user-data.sh \
		scripts/aws/apply-q27-preflight-iam.sh \
		scripts/aws/q27-preflight.sh \
		scripts/aws/q27-classify-prior-instance.sh \
		scripts/aws/q27-run-instances.sh
	./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
		--trainable-scope top-ffn \
		--text corpus/zero-foundation.txt --steps 4 --batch 1 \
		--lr 0.001 --warmup 1 --dropout 0.02 --cosine \
		--schedule-total 4 --report 4 --validation 1 --seed 77 \
		--save /tmp/q27-scope-full.ckpt --tokens 0 >/dev/null
	./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
		--trainable-scope top-ffn \
		--text corpus/zero-foundation.txt --steps 2 --batch 1 \
		--lr 0.001 --warmup 1 --dropout 0.02 --cosine \
		--schedule-total 4 --report 4 --validation 1 --seed 77 \
		--save /tmp/q27-scope-chunk.ckpt --tokens 0 >/dev/null
	./literary_lm --resume /tmp/q27-scope-chunk.ckpt \
		--trainable-scope top-ffn \
		--text corpus/zero-foundation.txt --steps 2 --batch 1 \
		--lr 0.001 --warmup 1 --dropout 0.02 --cosine \
		--schedule-offset 2 --schedule-total 4 --report 4 \
		--validation 1 --seed 77 --save /tmp/q27-scope-chunk.ckpt \
		--tokens 0 >/dev/null
	cmp /tmp/q27-scope-full.ckpt /tmp/q27-scope-chunk.ckpt
	! ./literary_lm --resume /tmp/q27-scope-full.ckpt \
		--steps 0 --tokens 0 >/dev/null 2>&1
	./literary_lm --preset literary --trainable-scope top-ffn \
		--steps 0 --tokens 0 | \
		grep 'trainable-scope=top-ffn trainable-parameters=541184'

zero4-q26r-check: zero4-q26-check \
		scripts/check_zero4_q26r.mjs scripts/aggregate_zero4_q26r.mjs \
		scripts/plan_q26r_aws_rescue.mjs \
		benchmarks/zero4-q26r-v1/contract.json \
		benchmarks/zero4-q26-v1/seed2/result.json \
		benchmarks/zero4-q26-v1/seed2/selected.litq8
	node scripts/check_zero4_q26r.mjs --self-test
	node scripts/aggregate_zero4_q26r.mjs --self-test
	node scripts/plan_q26r_aws_rescue.mjs --self-test
	node scripts/plan_q26r_aws_rescue.mjs --check-workflow \
		.github/workflows/q26r-aws-rescue.yml

zero4-q26r-train: literary_lm export_literary quantity_request_eval \
		zero4-q26r-check zero4-q22-data corpus/bpe/.zero3.stamp channel-data \
		scripts/train_zero4_q26.mjs
	node scripts/train_zero4_q26.mjs \
		--prefix $(ZERO4_Q26R_PREFIX) --out $(ZERO4_Q26R_RESULTS) \
		--data corpus/faculty/q22 \
		--replication-contract $(ZERO4_Q26R_CONTRACT) \
		--steps 1000 --consolidation-steps 400 --batch 2 \
		--seed $(ZERO4_Q26R_SEED) --recovery-every 25 --full-every 100 \
		--sentinel-replay-batches 12 --full-replay-batches 48

zero4-q26r: zero4-q26r-train

zero4-q26r-aggregate:
	node scripts/aggregate_zero4_q26r.mjs benchmarks/zero4-q26r-v1

zero4-q26r-aws-v2-check:
	node scripts/check_q26r_aws_v2_budget.mjs --self-test
	node scripts/check_q26r_aws_v2_budget.mjs \
		benchmarks/zero4-q26r-v1/aws-v2/budget.json
	node scripts/check_q26r_aws_v2_completion.mjs --self-test
	node scripts/check_q26r_aws_v2_workflows.mjs --self-test
	node scripts/check_q26r_aws_v2_workflows.mjs
	bash -n scripts/aws/q26r-v2-seed.sh
	bash -n scripts/aws/q26r-v2-seed-user-data.sh
	test ! -e benchmarks/zero4-q26r-v1/aws-v2/COMPLETED || \
		node scripts/check_q26r_aws_v2_completion.mjs

zero4-promotion-check:
	node scripts/check_zero4_promotion.mjs

promote-zero4:
	cp $(ZERO4_PROMOTED_ARTIFACT) docs/model.litq8
	node scripts/check_zero4_promotion.mjs

zero-eval1-calibration-check:
	if test -e benchmarks/zero-eval-1/aws-calibration/COMPLETED; then \
		node scripts/check_zero_eval1_calibration_completion.mjs --self-test; \
		node scripts/check_zero_eval1_calibration_completion.mjs; \
	else \
		node scripts/check_zero_eval1_calibration.mjs --self-test; \
		node scripts/check_zero_eval1_calibration.mjs \
			benchmarks/zero-eval-1/aws-calibration/budget.json; \
		node scripts/compile_zero_eval1_calibration_result.mjs --self-test; \
	fi
	bash -n scripts/aws/zero-eval1-calibration.sh
	bash -n scripts/aws/zero-eval1-calibration-user-data.sh

zero-eval1-full-budget-check: zero-eval1-calibration-check
	node scripts/check_zero_eval1_full_budget_proposal.mjs --self-test
	node scripts/check_zero_eval1_full_budget_proposal.mjs

zero-eval1-screen-check:
	node scripts/sample_zero_eval1_screen.mjs --self-test
	node scripts/check_zero_eval1_screen.mjs --self-test
	node scripts/compile_zero_eval1_screen_result.mjs --self-test
	node scripts/check_zero_eval1_screen_lambada_compat.mjs --self-test
	node scripts/check_zero_eval1_screen_budget.mjs \
		benchmarks/zero-eval-1/screen/aws/budget.json
	bash -n scripts/aws/zero-eval1-screen.sh
	bash -n scripts/aws/zero-eval1-screen-user-data.sh
	test ! -e benchmarks/zero-eval-1/screen/aws/COMPLETED || \
		node scripts/check_zero_eval1_screen_lambada_compat.mjs \
			--completion benchmarks/zero-eval-1/screen/aws/COMPLETED

zero-eval1-full-run-decision-check: zero-eval1-full-budget-check \
		zero-eval1-screen-check
	node scripts/check_zero_eval1_full_run_decision.mjs --self-test
	node scripts/check_zero_eval1_full_run_decision.mjs

zero-language-gate-check: external_eval zero-eval1-full-run-decision-check
	node scripts/run_zero_language_gate.mjs --self-test
	node scripts/check_zero_language_gate.mjs --self-test
	node scripts/check_zero_language_gate.mjs
	node scripts/check_zero_language_gate.mjs --mechanics ./external_eval

sat1-prereg-check: zero4-q26r-aws-v2-check zero-language-gate-check
	node scripts/check_sat1_preregistration.mjs --self-test
	node scripts/check_sat1_preregistration.mjs

experiment-budget-check: zero4-q26r-aws-v2-check zero-eval1-full-budget-check \
		zero-eval1-screen-check zero-eval1-full-run-decision-check \
		zero-language-gate-check sat1-prereg-check
	node scripts/check_experiment_budget.mjs --self-test
	node scripts/check_q26r_aws_budget.mjs --self-test
	node scripts/check_q26r_aws_budget.mjs \
		benchmarks/zero4-q26r-v1/aws-v1/budget.json
	node scripts/check_q26r_aws_completion.mjs --self-test
	test ! -e benchmarks/zero4-q26r-v1/aws-v1/COMPLETED || \
		node scripts/check_q26r_aws_completion.mjs
	node scripts/check_parallel_quantity_eval_budget.mjs --self-test
	node scripts/check_parallel_quantity_eval_budget.mjs \
		benchmarks/parallel-quantity-eval-calibration-v1/budget.json
	node scripts/check_parallel_quantity_eval_result.mjs --self-test
	node scripts/check_parallel_quantity_eval_result.mjs \
		benchmarks/parallel-quantity-eval-calibration-v1/budget.json \
		benchmarks/parallel-quantity-eval-calibration-v1/result-30044123890.json \
		benchmarks/parallel-quantity-eval-calibration-v1/status-30044123890.json \
		--commit f849fe8c8c1a448dcb6b24783e7edfdf56a5e92b \
		--budget-sha256 a8336e10316821c3420eaf9ad9a968319c4dc523302eec0300191259f7877962
	node scripts/check_q26_e2e_calibration_budget.mjs --self-test
	node scripts/check_q26_e2e_calibration_budget.mjs \
		benchmarks/openblas-e2e-calibration-v1/budget.json
	node scripts/check_q26_e2e_calibration_result.mjs --self-test
	node scripts/check_q26_e2e_calibration_result.mjs \
		benchmarks/openblas-e2e-calibration-v1/budget.json \
		benchmarks/openblas-e2e-calibration-v1/result-30023119249.json \
		benchmarks/openblas-e2e-calibration-v1/status-30023119249.json \
		--commit c5dc800e2ee9b8830807b6cfbccbae39b4db6a45 \
		--budget-sha256 931d38f8ae29faf38a1f92689a5dbdf538d3be55ab3399936af0b6618cde07d3
	node scripts/calibrate_zero4_q26_e2e.mjs --self-test
	node scripts/check_experiment_budget.mjs \
		benchmarks/openblas-calibration-v1/budget.json --stage calibration
	node scripts/check_experiment_budget.mjs \
		benchmarks/openblas-pilot-v1/budget.json --stage pilot
	node scripts/check_openblas_calibration_result.mjs --self-test
	node scripts/check_openblas_calibration_result.mjs \
		benchmarks/openblas-calibration-v1/retry-1-budget.json \
		benchmarks/openblas-calibration-v1/result-30003995100.json \
		benchmarks/openblas-calibration-v1/status-30003995100.json \
		--commit 96cf43afa8e8bc4d958ad96a6da304994ed85b39 \
		--budget-sha256 19800e5c9b8ca36c31f03de54364b22e7f462c4ed3a444bd17fd62d7794577d9
	node scripts/check_openblas_calibration_result.mjs \
		benchmarks/openblas-pilot-v1/budget.json \
		benchmarks/openblas-pilot-v1/result-30005889393.json \
		benchmarks/openblas-pilot-v1/status-30005889393.json \
		--commit 39f6ec843c98a301a4450c55fcee73d93923c908 \
		--budget-sha256 6af80f465e9431331affdfdefd7c0af41488d6514b3d871cff0c2242c3ac79d2

zero4-q22r-aggregate:
	node scripts/aggregate_zero4_q22r.mjs benchmarks/zero4-q22r-v1

corpus/brainfuck/.generated: brainfuck_corpus
	mkdir -p corpus/brainfuck
	./brainfuck_corpus \
		--output corpus/brainfuck/brainfuck.txt \
		--tokens corpus/brainfuck/brainfuck.tok \
		--examples $(MONKEY_BF_EXAMPLES) --seed $(MONKEY_SEED) \
		--validation-percent 5
	touch $@

brainfuck-data: corpus/brainfuck/.generated
	./brainfuck_corpus --verify corpus/brainfuck/brainfuck.txt

corpus/brainfuck/.trace-generated: brainfuck_corpus
	mkdir -p corpus/brainfuck
	./brainfuck_corpus --trace-composition \
		--output corpus/brainfuck/trace-composition.txt \
		--tokens corpus/brainfuck/trace-composition.tok \
		--examples $(MONKEY_TRACE_EXAMPLES) --seed $(MONKEY_SEED) \
		--validation-percent 5
	touch $@

brainfuck-trace-data: corpus/brainfuck/.trace-generated
	./brainfuck_corpus --verify corpus/brainfuck/trace-composition.txt

monkey-trace10m-data: corpus/brainfuck/.monkey-data \
		corpus/brainfuck/.trace-generated
	./brainfuck_corpus --verify corpus/brainfuck/brainfuck.txt
	./brainfuck_corpus --verify corpus/brainfuck/trace-composition.txt

corpus/logic/hf-monkey.txt: logic_corpus
	mkdir -p corpus/logic
	./logic_corpus --output $@ --examples $(MONKEY_LOGIC_EXAMPLES) \
		--seed $(MONKEY_SEED) --max-depth 3 --max-chars 480
	./logic_corpus --verify $@

corpus/logic/.monkey-tokenized: bpe_tokenizer corpus/logic/hf-monkey.txt
	mkdir -p corpus/brainfuck corpus/logic
	./bpe_tokenizer --vocab corpus/brainfuck/monkey.bpe \
		--text corpus/logic/hf-monkey.txt \
		--out corpus/logic/hf-monkey.tok
	touch $@

corpus/brainfuck/.monkey-data: corpus/brainfuck/.generated \
		corpus/logic/.monkey-tokenized corpus/bpe/shakespeare.tok \
		corpus/bpe/blake.tok corpus/bpe/crowley.tok
	./brainfuck_corpus --verify corpus/brainfuck/brainfuck.txt
	touch $@

monkey-data: corpus/brainfuck/.monkey-data

$(MONKEY_PREFIX)-bf.ckpt: corpus/brainfuck/.monkey-data | literary_lm
	./literary_lm --preset literary \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 1 \
		--artifact-weight 4 \
		--steps $(MONKEY_BF_STEPS) --batch $(MONKEY_BATCH) \
		--lr 0.0002 --warmup 200 --dropout 0.08 --cosine \
		--report 100 --validation 40 --patience 5 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_PREFIX)-bf-last.ckpt \
		--save-every 500 --tokens 0

monkey-bf: $(MONKEY_PREFIX)-bf.ckpt

$(MONKEY_PREFIX)-logic.ckpt: corpus/brainfuck/.monkey-data $(MONKEY_PREFIX)-bf.ckpt | literary_lm
	./literary_lm --init $(MONKEY_PREFIX)-bf.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 2 \
		--text corpus/logic/hf-monkey.tok --sample-weight 3 \
		--artifact-weight 4 \
		--steps $(MONKEY_LOGIC_STEPS) --batch $(MONKEY_BATCH) \
		--lr 0.00008 --warmup 200 --dropout 0.08 --cosine \
		--report 100 --validation 48 --patience 5 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_PREFIX)-logic-last.ckpt \
		--save-every 500 --tokens 0

monkey-logic: $(MONKEY_PREFIX)-logic.ckpt

$(MONKEY_PREFIX)-shakespeare.ckpt: corpus/brainfuck/.monkey-data $(MONKEY_PREFIX)-logic.ckpt | literary_lm
	./literary_lm --init $(MONKEY_PREFIX)-logic.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 1 \
		--text corpus/logic/hf-monkey.tok --sample-weight 1 \
		--text corpus/bpe/shakespeare.tok --sample-weight 3 \
		--artifact-weight 4 \
		--steps $(MONKEY_SHAKESPEARE_STEPS) --batch $(MONKEY_BATCH) \
		--lr 0.00005 --warmup 150 --dropout 0.07 --cosine \
		--report 100 --validation 48 --patience 30 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_PREFIX)-shakespeare-last.ckpt \
		--save-every 500 --tokens 0

monkey-shakespeare: $(MONKEY_PREFIX)-shakespeare.ckpt

$(MONKEY_PREFIX)-blake.ckpt: corpus/brainfuck/.monkey-data $(MONKEY_PREFIX)-shakespeare.ckpt | literary_lm
	./literary_lm --init $(MONKEY_PREFIX)-shakespeare.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 1 \
		--text corpus/logic/hf-monkey.tok --sample-weight 1 \
		--text corpus/bpe/shakespeare.tok --sample-weight 1 \
		--text corpus/bpe/blake.tok --sample-weight 3 \
		--artifact-weight 4 \
		--steps $(MONKEY_BLAKE_STEPS) --batch $(MONKEY_BATCH) \
		--lr 0.00004 --warmup 100 --dropout 0.06 --cosine \
		--report 100 --validation 56 --patience 5 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_PREFIX)-blake-last.ckpt \
		--save-every 500 --tokens 0

monkey-blake: $(MONKEY_PREFIX)-blake.ckpt

$(MONKEY_PREFIX)-crowley.ckpt: corpus/brainfuck/.monkey-data $(MONKEY_PREFIX)-blake.ckpt | literary_lm
	./literary_lm --init $(MONKEY_PREFIX)-blake.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 1 \
		--text corpus/logic/hf-monkey.tok --sample-weight 1 \
		--text corpus/bpe/shakespeare.tok --sample-weight 1 \
		--text corpus/bpe/blake.tok --sample-weight 1 \
		--text corpus/bpe/crowley.tok --sample-weight 3 \
		--artifact-weight 4 \
		--steps $(MONKEY_CROWLEY_STEPS) --batch $(MONKEY_BATCH) \
		--lr 0.000035 --warmup 100 --dropout 0.06 --cosine \
		--report 100 --validation 64 --patience 5 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_PREFIX)-crowley-last.ckpt \
		--save-every 500 --tokens 0

monkey-crowley: $(MONKEY_PREFIX)-crowley.ckpt

$(MONKEY_PREFIX)-final.ckpt: corpus/brainfuck/.monkey-data $(MONKEY_PREFIX)-crowley.ckpt | literary_lm
	./literary_lm --init $(MONKEY_PREFIX)-crowley.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 3 \
		--text corpus/logic/hf-monkey.tok --sample-weight 3 \
		--text corpus/bpe/shakespeare.tok --sample-weight 2 \
		--text corpus/bpe/blake.tok --sample-weight 2 \
		--text corpus/bpe/crowley.tok --sample-weight 2 \
		--artifact-weight 4 \
		--steps $(MONKEY_CONSOLIDATE_STEPS) --batch $(MONKEY_BATCH) \
		--lr 0.00002 --warmup 100 --dropout 0.05 --cosine \
		--report 100 --validation 80 --patience 5 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_PREFIX)-final-last.ckpt \
		--save-every 500 --tokens 0

monkey-consolidate: $(MONKEY_PREFIX)-final.ckpt

$(MONKEY_PREFIX)-literary.ckpt: corpus/brainfuck/.monkey-data $(MONKEY_PREFIX)-final.ckpt | literary_lm
	./literary_lm --init $(MONKEY_PREFIX)-final.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 1 \
		--text corpus/logic/hf-monkey.tok --sample-weight 1 \
		--text corpus/bpe/shakespeare.tok --sample-weight 4 \
		--text corpus/bpe/blake.tok --sample-weight 4 \
		--text corpus/bpe/crowley.tok --sample-weight 4 \
		--artifact-weight 4 \
		--steps $(MONKEY_LITERARY_STEPS) --batch $(MONKEY_BATCH) \
		--lr 0.00003 --warmup 150 --dropout 0.06 --cosine \
		--report 100 --validation 96 --patience 8 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_PREFIX)-literary-last.ckpt \
		--save-every 500 --tokens 0

monkey-literary: $(MONKEY_PREFIX)-literary.ckpt

$(MONKEY_PREFIX)-balanced.ckpt: corpus/brainfuck/.monkey-data $(MONKEY_PREFIX)-literary.ckpt | literary_lm
	./literary_lm --init $(MONKEY_PREFIX)-literary.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 3 \
		--text corpus/logic/hf-monkey.tok --sample-weight 3 \
		--text corpus/bpe/shakespeare.tok --sample-weight 2 \
		--text corpus/bpe/blake.tok --sample-weight 2 \
		--text corpus/bpe/crowley.tok --sample-weight 2 \
		--artifact-weight 4 \
		--steps $(MONKEY_REBALANCE_STEPS) --batch $(MONKEY_BATCH) \
		--lr 0.00001 --warmup 50 --dropout 0.03 --cosine \
		--report 100 --validation 96 --patience 8 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_PREFIX)-balanced-last.ckpt \
		--save-every 500 --tokens 0

monkey-rebalance: $(MONKEY_PREFIX)-balanced.ckpt

monkey-train: monkey-rebalance

$(MONKEY_PREFIX)-balanced.litq8: export_literary $(MONKEY_PREFIX)-balanced.ckpt
	./export_literary $(MONKEY_PREFIX)-balanced.ckpt $@

monkey-eval: literary_lm literary_infer brainfuck_corpus \
		$(MONKEY_PREFIX)-balanced.litq8
	mkdir -p $(MONKEY_RESULTS)
	./literary_lm --resume $(MONKEY_PREFIX)-balanced.ckpt --eval-only \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --artifact-weight 4 \
		--validation 96 | tee $(MONKEY_RESULTS)/brainfuck-loss.log
	./literary_lm --resume $(MONKEY_PREFIX)-balanced.ckpt --eval-only \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--text corpus/logic/hf-monkey.tok --validation 96 \
		| tee $(MONKEY_RESULTS)/logic-loss.log
	./literary_lm --resume $(MONKEY_PREFIX)-balanced.ckpt --eval-only \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--text corpus/bpe/shakespeare.tok --validation 96 \
		| tee $(MONKEY_RESULTS)/shakespeare-loss.log
	./literary_lm --resume $(MONKEY_PREFIX)-balanced.ckpt --eval-only \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--text corpus/bpe/blake.tok --validation 96 \
		| tee $(MONKEY_RESULTS)/blake-loss.log
	./literary_lm --resume $(MONKEY_PREFIX)-balanced.ckpt --eval-only \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--text corpus/bpe/crowley.tok --validation 96 \
		| tee $(MONKEY_RESULTS)/crowley-loss.log
	node scripts/evaluate_monkey_brainfuck.mjs \
		--model $(MONKEY_PREFIX)-balanced.litq8 --split train --limit 40 \
		--json $(MONKEY_RESULTS)/brainfuck-balanced-train.json
	node scripts/evaluate_monkey_brainfuck.mjs \
		--model $(MONKEY_PREFIX)-balanced.litq8 --split validation --limit 40 \
		--json $(MONKEY_RESULTS)/brainfuck-balanced-validation.json

$(MONKEY_TRACE_PREFIX)-brainfuck.ckpt: corpus/brainfuck/.monkey-data \
		corpus/brainfuck/.trace-generated | literary_lm
	./literary_lm --preset literary \
		--context 512 --dim 320 --heads 8 --layers 8 --ff 1280 \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 1 \
		--hard-channel corpus/brainfuck/trace-composition.tok --sample-weight 5 \
		--artifact-weight 6 \
		--steps $(MONKEY_TRACE_STEPS) --batch $(MONKEY_TRACE_BATCH) \
		--lr 0.00015 --warmup 300 --dropout 0.08 --cosine \
		--report 100 --validation 112 --patience 20 --seed $(MONKEY_SEED) \
		--best $@ --save $(MONKEY_TRACE_PREFIX)-brainfuck-last.ckpt \
		--save-every 500 --tokens 0

monkey-trace10m-train: $(MONKEY_TRACE_PREFIX)-brainfuck.ckpt

$(MONKEY_TRACE_PREFIX)-brainfuck.litq8: export_literary \
		$(MONKEY_TRACE_PREFIX)-brainfuck.ckpt
	./export_literary $(MONKEY_TRACE_PREFIX)-brainfuck.ckpt $@

$(MONKEY_TRACE_PREFIX)-brainfuck-last.ckpt: \
		$(MONKEY_TRACE_PREFIX)-brainfuck.ckpt
	test -f $@

$(MONKEY_TRACE_PREFIX)-brainfuck-last.litq8: export_literary \
		$(MONKEY_TRACE_PREFIX)-brainfuck-last.ckpt
	./export_literary $(MONKEY_TRACE_PREFIX)-brainfuck-last.ckpt $@

monkey-trace10m-eval: literary_lm literary_infer brainfuck_corpus \
		$(MONKEY_TRACE_PREFIX)-brainfuck.litq8 \
		$(MONKEY_TRACE_PREFIX)-brainfuck-last.litq8
	mkdir -p $(MONKEY_TRACE_RESULTS)
	./literary_lm --resume $(MONKEY_TRACE_PREFIX)-brainfuck.ckpt --eval-only \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/trace-composition.tok \
		--artifact-weight 6 --validation 112 \
		| tee $(MONKEY_TRACE_RESULTS)/trace-composition-loss.log
	node scripts/evaluate_monkey_brainfuck.mjs \
		--model $(MONKEY_TRACE_PREFIX)-brainfuck.litq8 \
		--corpus corpus/brainfuck/trace-composition.txt \
		--split train --limit 42 \
		--json $(MONKEY_TRACE_RESULTS)/brainfuck-trace-train.json
	node scripts/evaluate_monkey_brainfuck.mjs \
		--model $(MONKEY_TRACE_PREFIX)-brainfuck.litq8 \
		--corpus corpus/brainfuck/trace-composition.txt \
		--split validation --limit 42 \
		--json $(MONKEY_TRACE_RESULTS)/brainfuck-trace-validation.json
	node scripts/evaluate_monkey_brainfuck.mjs \
		--model $(MONKEY_TRACE_PREFIX)-brainfuck-last.litq8 \
		--corpus corpus/brainfuck/trace-composition.txt \
		--split validation --limit 42 \
		--json $(MONKEY_TRACE_RESULTS)/brainfuck-trace-last-validation.json

monkey-trace10m-smoke: literary_lm monkey-trace10m-data
	./literary_lm --preset literary \
		--context 512 --dim 320 --heads 8 --layers 8 --ff 1280 \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 1 \
		--hard-channel corpus/brainfuck/trace-composition.tok --sample-weight 5 \
		--artifact-weight 6 --steps 2 --batch 1 --lr 0.0001 \
		--warmup 1 --report 1 --validation 7 \
		--best /tmp/monkey-trace10m-smoke.ckpt --tokens 0

monkey-smoke: literary_lm monkey-data
	./literary_lm --preset literary --tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --artifact-weight 4 \
		--steps 10 --batch 1 --lr 0.0001 --warmup 2 --report 10 \
		--validation 10 --best /tmp/monkey-bf.ckpt --tokens 0
	./literary_lm --init /tmp/monkey-bf.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok --sample-weight 2 \
		--text corpus/logic/hf-monkey.tok --sample-weight 3 \
		--steps 10 --batch 1 --lr 0.00005 --warmup 2 --report 10 \
		--validation 10 --best /tmp/monkey-logic.ckpt --tokens 0
	./literary_lm --init /tmp/monkey-logic.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok \
		--text corpus/logic/hf-monkey.tok \
		--text corpus/bpe/shakespeare.tok --sample-weight 2 \
		--steps 10 --batch 1 --lr 0.00003 --warmup 2 --report 10 \
		--validation 12 --best /tmp/monkey-shakespeare.ckpt --tokens 0
	./literary_lm --init /tmp/monkey-shakespeare.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok \
		--text corpus/logic/hf-monkey.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok --sample-weight 2 \
		--steps 10 --batch 1 --lr 0.00003 --warmup 2 --report 10 \
		--validation 12 --best /tmp/monkey-blake.ckpt --tokens 0
	./literary_lm --init /tmp/monkey-blake.ckpt \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok \
		--text corpus/logic/hf-monkey.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok --sample-weight 2 \
		--steps 10 --batch 1 --lr 0.00003 --warmup 2 --report 10 \
		--validation 15 --best /tmp/monkey-crowley.ckpt --tokens 0
	./literary_lm --init /tmp/monkey-crowley.ckpt --eval-only \
		--tokenizer corpus/brainfuck/monkey.bpe \
		--hard-channel corpus/brainfuck/brainfuck.tok \
		--text corpus/logic/hf-monkey.tok \
		--text corpus/bpe/shakespeare.tok \
		--text corpus/bpe/blake.tok \
		--text corpus/bpe/crowley.tok --validation 20

check: reasoner41-result-check reasoner42-result-check
check: sero-series-closure-check zero5-c0-check zero5-c1-check zero5-c2-check zero5-c3-check zero5-c31-check zero5-c32-check zero5-c33-check zero5-c33-parallel-check zero5-c33-parallel-result-check zero5-c42-check zero5-c42-aws-check zero5-c42-result-check zero5-c43-spec-check zero5-c43-prep-check zero5-c43-contract-check zero5-c43-result-check zero5-c51-result-check zero5-c52-result-check zero5-c51-statebridge-check zero5-c61-shared-state-check zero5-hierarchical-tokenization-check zero5-cpu-profile-check zero5-cpu-profile-aws-check zero5-cpu-profile-aws-result-check zero5-vector-math-check zero5-vector-math-aws-check zero5-vector-math-aws-result-check zero5-blocked-attention-check zero5-tensor-batch-check zero5-tensor-aws-check zero5-tensor-aws-result-check
check: zero_lm literary_lm logic_corpus brainfuck_corpus channel_corpus faculty_controller freeze_literary_teacher literary_infer zero_eval faculty_eval quantity-request-eval-check zero4-q22-shared-task-check zero4-q22-compositional-shared-task-check zero4-promotion-check external-eval-check experiment-evidence-check literature-review-pipeline-check zero4-q27-check zero4-post-q27-research-check zero4-q28-check zero4-q28-activation-check zero4-q28-language-gate-check zero4-q28-u100-language-gate-check zero4-q29-check zero4-q29-language-gate-check zero4-q30-check zero4-q31-check zero4-q32-check zero4-q32-result-check zero4-q32-public-check zero4-q32-public-result-check zero4-q32-promotion-check zero4-q32-promotion-result-check zero4-q33-semantic-check zero4-q33-semantic-result-check zero4-q34-semantic-head-check zero4-q34-semantic-head-result-check corpus-rights-check zero-data-pipeline-check sero-corpus-plan-check sero0-check sero-latent-v1-result-check sero-latent-v2-result-check sero-latent-v3-contract-check sero-latent-v3-aws-check sero-latent-v3-result-check sero1-tokenizer-check sero1-pretrain-contract-check sero1-pretrain-aws-check sero1-pretrain-result-check sero1-generation-eval-result-check reasoner0-check reasoner1-check reasoner2-check reasoner3-check reasoner31-check reasoner32-check reasoner33-check reasoner34-check reasoner34-contract-check reasoner333-check reasoner34-witness-check reasoner35-check reasoner35-contract-check reasoner36-check reasoner36-contract-check reasoner37-check reasoner37-contract-check reasoner38-check reasoner38-contract-check reasoner39-check reasoner39-contract-check reasoner310-check reasoner310-contract-check reasoner40-check reasoner40-contract-check reasoner40-result-check reasoner41-check reasoner41-contract-check reasoner42-check reasoner42-contract-check weight-multiplicity-check
	./zero_lm --steps 200 --tokens 16 --seed 0 \
		--save /tmp/zero1-check.ckpt >/dev/null
	./zero_lm --load /tmp/zero1-check.ckpt --tokens 16 --seed 0 >/dev/null
	./literary_lm --self-test >/dev/null
	./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
		--text corpus/zero-foundation.txt --steps 2 --batch 1 \
		--report 2 --validation 1 --save /tmp/zero2-check.ckpt \
		--tokens 0 >/dev/null
	./freeze_literary_teacher /tmp/zero2-check.ckpt \
		/tmp/zero2-check.teacher >/dev/null
	./literary_lm --resume /tmp/zero2-check.ckpt \
		--teacher /tmp/zero2-check.teacher --teacher-weight 0.15 \
		--teacher /tmp/zero2-check.teacher --teacher-weight 0.10 \
		--zero1-teacher /tmp/zero1-check.ckpt --zero1-weight 0.25 \
		--foundation corpus/zero-foundation.txt --distill 0.25,0.15,0.10 \
		--steps 1 --batch 1 \
		--report 1 --validation 1 --save /tmp/zero3-check.ckpt \
		--tokens 0 >/dev/null
	./freeze_literary_teacher /tmp/zero3-check.ckpt \
		/tmp/zero3-check.teacher >/dev/null
	./literary_lm --init /tmp/zero3-check.teacher --eval-only \
		--text corpus/zero-foundation.txt --validation 1 >/dev/null
	./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
		--text corpus/zero-foundation.txt --steps 4 --batch 1 \
		--lr 0.001 --warmup 1 --dropout 0.02 --cosine --schedule-total 4 \
		--report 4 --validation 1 --seed 77 --save /tmp/q22-full.ckpt \
		--tokens 0 >/dev/null
	./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
		--text corpus/zero-foundation.txt --steps 2 --batch 1 \
		--lr 0.001 --warmup 1 --dropout 0.02 --cosine --schedule-total 4 \
		--report 4 --validation 1 --seed 77 --save /tmp/q22-chunk.ckpt \
		--tokens 0 >/dev/null
	./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
		--resume /tmp/q22-chunk.ckpt --text corpus/zero-foundation.txt \
		--steps 2 --batch 1 --lr 0.001 --warmup 1 --dropout 0.02 \
		--cosine --schedule-offset 2 --schedule-total 4 --report 4 \
		--validation 1 --seed 77 --save /tmp/q22-chunk.ckpt \
		--tokens 0 >/dev/null
	cmp /tmp/q22-full.ckpt /tmp/q22-chunk.ckpt
	node scripts/train_zero4_q22.mjs --self-test >/dev/null
	$(MAKE) zero4-q23-check >/dev/null
	$(MAKE) zero4-q24-check >/dev/null
	$(MAKE) zero4-q25-check >/dev/null
	$(MAKE) zero4-q26-check >/dev/null
	$(MAKE) zero4-q26r-check >/dev/null
	$(MAKE) experiment-budget-check >/dev/null
	python3 scripts/compile_result.py --self-test >/dev/null
	./logic_corpus --self-test >/dev/null
	./brainfuck_corpus --self-test >/dev/null
	./channel_corpus --self-test >/dev/null
	./faculty_controller --self-test >/dev/null
	./faculty_eval --self-test >/dev/null
	./channel_corpus --chat H tests/fixtures/channel.tsv \
		--out /tmp/zero-channel-test.tok >/dev/null
	./literary_infer --holo-self-test >/dev/null
	./zero_eval --self-test >/dev/null
	node scripts/render_zero_results.mjs --check \
		benchmarks/zero-channel-v1/manifest.json \
		benchmarks/zero-channel-v1/results/baseline.json \
		benchmarks/zero-channel-v1/results/BASELINE.md >/dev/null

clean:
	rm -f zero_lm literary_lm zero5_lm zero5_c2_lm zero5_c3_lm zero5_c31_lm zero5_c32_lm zero5_c32_lm_fast zero5_c32_lm_profile zero5_c32_lm_vector_tanh zero5_c32_lm_vector_exp zero5_c32_lm_vector_math zero5_c32_lm_attention_b32 zero5_c32_lm_attention_b64 zero5_c32_lm_attention_b128 zero5_c32_lm_qkv_forward zero5_c32_lm_qkv_backward zero5_c32_lm_qkv zero5_c32_lm_tensor zero5_c32_lm_tensor_qkv zero5_c51_target_lm zero5_c61_bottleneck_lm zero5_braid bpe_tokenizer sero_tokenizer logic_corpus brainfuck_corpus channel_corpus faculty_controller export_literary freeze_literary_teacher literary_infer memorization_eval zero_eval faculty_eval quantity_request_eval external_eval quantity_adapter_pilot package_quantity_adapter quantity_adapter_infer quantity_adapter_request_eval base_probability_infer operation_head_pilot package_operation_head operation_head_infer operation_head_request_eval runtime_operation_head_pilot package_runtime_operation_head semantic_operation_eval semantic_runtime_head_pilot reasoner0 reasoner1 reasoner2 reasoner3 reasoner31 reasoner32 reasoner33 reasoner34 reasoner333 reasoner34_witness reasoner35 reasoner36 reasoner37 reasoner38 reasoner39 reasoner310 reasoner40 reasoner41 reasoner42 weight_multiplicity weight_multiplicity_crosscheck
	rm -f docs/literary.js docs/literary.wasm
