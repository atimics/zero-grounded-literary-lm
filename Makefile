CC ?= cc
CFLAGS ?= -O2 -std=c11 -Wall -Wextra -Wpedantic
EMCC ?= emcc
UNAME_S := $(shell uname -s)
KJV_URL := https://www.gutenberg.org/ebooks/30.txt.utf-8
ZERO2_CHECKPOINT ?= literary-v8-consolidated.ckpt
ZERO3_STEPS ?= 6000
ZERO3_CONSOLIDATION_STEPS ?= 1200
ZERO3_BALANCE_STEPS ?= 400
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
ZERO4_Q26R_SEED ?= 1
ZERO4_Q26R_PREFIX ?= /tmp/zero4-q26r-seed$(ZERO4_Q26R_SEED)
ZERO4_Q26R_RESULTS ?= benchmarks/zero4-q26r-v1/seed$(ZERO4_Q26R_SEED)
ZERO4_Q26R_CONTRACT ?= benchmarks/zero4-q26r-v1/contract.json
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

ifeq ($(UNAME_S),Darwin)
LITERARY_CFLAGS := -DUSE_ACCELERATE -DACCELERATE_NEW_LAPACK
LITERARY_LDLIBS := -framework Accelerate -lm
else
LITERARY_CFLAGS :=
LITERARY_LDLIBS := -lm
endif

.PHONY: all check clean web channel-data zero3-data zero3-stage1 \
	zero3-consolidate zero3-balance zero3-train zero-benchmark \
	zero-benchmark-check zero4-faculty-data zero4-faculty-check zero4-smoke \
	zero4-q1-train zero4-q1-eval zero4-q1 zero4-q2-data zero4-q2-check \
	zero4-q2-train zero4-q2-eval zero4-q2 zero4-q21-data zero4-q21-check \
	zero4-q21-train zero4-q21-consolidate zero4-q21-eval zero4-q21 \
	zero4-q22-data zero4-q22-check zero4-q22-train zero4-q22-eval zero4-q22 \
	zero4-q22r-check zero4-q22r-train zero4-q22r-eval zero4-q22r \
	zero4-q22r-aggregate \
	zero4-q23-check zero4-q23-observer zero4-q23-train zero4-q23 \
	zero4-q24-check zero4-q24-train zero4-q24 \
	zero4-q25-check zero4-q25-train zero4-q25 \
	zero4-q26-check zero4-q26-train zero4-q26 \
	zero4-q26r-check zero4-q26r-train zero4-q26r zero4-q26r-aggregate \
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

all: zero_lm literary_lm bpe_tokenizer logic_corpus brainfuck_corpus channel_corpus faculty_controller export_literary freeze_literary_teacher literary_infer zero_eval faculty_eval quantity_request_eval

zero_lm: zero_lm.c zero1_protocol.h
	$(CC) $(CFLAGS) zero_lm.c -o $@ -lm

literary_lm: literary_lm.c channel_protocol.h zero1_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) literary_lm.c -o $@ $(LITERARY_LDLIBS)

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

zero_eval: zero_eval.c literary_infer.c literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) -DLITERARY_INFER_NO_MAIN zero_eval.c literary_infer.c -o $@ -lm

faculty_eval: faculty_eval.c literary_infer.c literary_infer.h channel_protocol.h
	$(CC) $(CFLAGS) -DLITERARY_INFER_NO_MAIN faculty_eval.c literary_infer.c -o $@ -lm

quantity_request_eval: quantity_request_eval.c literary_infer.c literary_infer.h faculty_controller.c faculty_protocol.h quantity_oracle.c quantity_oracle.h channel_protocol.h
	$(CC) $(CFLAGS) -DLITERARY_INFER_NO_MAIN -DFACULTY_CONTROLLER_NO_MAIN quantity_request_eval.c literary_infer.c faculty_controller.c quantity_oracle.c -o $@ -lm

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

docs/model.litq8: export_literary literary-v8-last.ckpt
	./export_literary literary-v8-last.ckpt $@

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

zero-benchmark: zero_eval docs/model.litq8 benchmarks/zero-channel-v1/manifest.json
	mkdir -p benchmarks/zero-channel-v1/results
	./zero_eval docs/model.litq8 \
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

zero4-q22-data: scripts/generate_zero4_q2.mjs
	mkdir -p corpus/faculty/q22
	node scripts/generate_zero4_q2.mjs --out corpus/faculty/q22 \
		--quantity 10000 --seed 5 --request-mode operation

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

zero4-q26r-check: zero4-q26-check \
		scripts/check_zero4_q26r.mjs scripts/aggregate_zero4_q26r.mjs \
		benchmarks/zero4-q26r-v1/contract.json \
		benchmarks/zero4-q26-v1/seed2/result.json \
		benchmarks/zero4-q26-v1/seed2/selected.litq8
	node scripts/check_zero4_q26r.mjs --self-test
	node scripts/aggregate_zero4_q26r.mjs --self-test

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

check: zero_lm literary_lm logic_corpus brainfuck_corpus channel_corpus faculty_controller freeze_literary_teacher literary_infer zero_eval faculty_eval quantity_request_eval
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
	rm -f zero_lm literary_lm bpe_tokenizer logic_corpus brainfuck_corpus channel_corpus faculty_controller export_literary freeze_literary_teacher literary_infer zero_eval faculty_eval quantity_request_eval
	rm -f docs/literary.js docs/literary.wasm
