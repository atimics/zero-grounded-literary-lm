CC ?= cc
CFLAGS ?= -O2 -std=c11 -Wall -Wextra -Wpedantic
EMCC ?= emcc
ZERO_WEB_ARTIFACT ?= teachers/zero3-balanced-final.teacher
UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
LITERARY_CFLAGS := -DUSE_ACCELERATE -DACCELERATE_NEW_LAPACK
LITERARY_LDLIBS := -framework Accelerate -lm
else
LITERARY_CFLAGS :=
LITERARY_LDLIBS := -lm
endif

.PHONY: all check clean web channel-data

all: zero_lm literary_lm bpe_tokenizer logic_corpus channel_corpus export_literary literary_infer

zero_lm: zero_lm.c
	$(CC) $(CFLAGS) zero_lm.c -o $@ -lm

literary_lm: literary_lm.c channel_protocol.h
	$(CC) $(CFLAGS) $(LITERARY_CFLAGS) literary_lm.c -o $@ $(LITERARY_LDLIBS)

bpe_tokenizer: bpe_tokenizer.c
	$(CC) $(CFLAGS) bpe_tokenizer.c -o $@

logic_corpus: logic_corpus.c
	$(CC) $(CFLAGS) logic_corpus.c -o $@

channel_corpus: channel_corpus.c channel_protocol.h
	$(CC) $(CFLAGS) channel_corpus.c -o $@

export_literary: export_literary.c
	$(CC) $(CFLAGS) export_literary.c -o $@ -lm

literary_infer: literary_infer.c channel_protocol.h
	$(CC) $(CFLAGS) literary_infer.c -o $@ -lm

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

docs/model.litq8: export_literary $(ZERO_WEB_ARTIFACT)
	./export_literary $(ZERO_WEB_ARTIFACT) $@

docs/literary.js docs/literary.wasm: literary_infer.c channel_protocol.h
	$(EMCC) literary_infer.c -O3 -msimd128 --no-entry \
		-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node \
		-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 \
		-sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
		-sEXPORTED_FUNCTIONS='["_malloc","_free","_lm_load","_lm_reset","_lm_seed","_lm_feed","_lm_sample","_lm_get_context","_lm_get_position","_lm_get_update","_lm_get_parameters","_lm_holo_reset","_lm_holo_remember","_lm_holo_recall","_lm_holo_get_score","_lm_holo_get_count"]' \
		-o docs/literary.js

web: docs/model.litq8 docs/literary.js docs/literary.wasm

check: zero_lm literary_lm logic_corpus channel_corpus literary_infer
	./zero_lm --steps 200 --tokens 16 --seed 0 >/dev/null
	./literary_lm --self-test >/dev/null
	./literary_lm --context 8 --dim 8 --heads 2 --layers 1 --ff 16 \
		--steps 4 --batch 1 --report 2 --validation 1 --tokens 0 >/dev/null
	./logic_corpus --self-test >/dev/null
	./channel_corpus --self-test >/dev/null
	./channel_corpus --chat H tests/fixtures/channel.tsv \
		--out /tmp/zero-channel-test.tok >/dev/null
	./literary_infer --holo-self-test >/dev/null

clean:
	rm -f zero_lm literary_lm bpe_tokenizer logic_corpus channel_corpus export_literary literary_infer
	rm -f docs/literary.js docs/literary.wasm
