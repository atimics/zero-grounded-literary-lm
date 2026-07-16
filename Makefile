CC ?= cc
CFLAGS ?= -O2 -std=c11 -Wall -Wextra -Wpedantic
EMCC ?= emcc
UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
LITERARY_CFLAGS := -DUSE_ACCELERATE -DACCELERATE_NEW_LAPACK
LITERARY_LDLIBS := -framework Accelerate -lm
else
LITERARY_CFLAGS :=
LITERARY_LDLIBS := -lm
endif

.PHONY: all check clean web

all: zero_lm literary_lm bpe_tokenizer logic_corpus export_literary literary_infer

zero_lm: zero_lm.c
	$(CC) $(CFLAGS) zero_lm.c -o $@ -lm

literary_lm: literary_lm.c
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) literary_lm.c -o $@ $(LITERARY_LDLIBS)

bpe_tokenizer: bpe_tokenizer.c
	$(CC) $(CFLAGS) bpe_tokenizer.c -o $@

logic_corpus: logic_corpus.c
	$(CC) $(CFLAGS) logic_corpus.c -o $@

export_literary: export_literary.c
	$(CC) $(CFLAGS) export_literary.c -o $@ -lm

literary_infer: literary_infer.c
	$(CC) $(CFLAGS) literary_infer.c -o $@ -lm

docs/model.litq8: export_literary literary-v6.ckpt
	./export_literary literary-v6.ckpt $@

docs/literary.js docs/literary.wasm &: literary_infer.c
	$(EMCC) literary_infer.c -O3 -msimd128 --no-entry \
		-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node \
		-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 \
		-sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
		-sEXPORTED_FUNCTIONS='["_malloc","_free","_lm_load","_lm_reset","_lm_seed","_lm_feed","_lm_sample","_lm_get_context","_lm_get_position","_lm_get_update","_lm_get_parameters"]' \
		-o docs/literary.js

web: docs/model.litq8 docs/literary.js docs/literary.wasm

check: zero_lm literary_lm logic_corpus
	./zero_lm --steps 200 --tokens 16 --seed 0 >/dev/null
	./literary_lm --self-test >/dev/null
	./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
		--steps 4 --batch 1 --report 2 --validation 1 --tokens 0 >/dev/null
	./logic_corpus --self-test >/dev/null

clean:
	rm -f zero_lm literary_lm bpe_tokenizer logic_corpus export_literary literary_infer
	rm -f docs/literary.js docs/literary.wasm
