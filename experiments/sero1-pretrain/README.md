# Sero 1 pretraining

This directory trains the first Sero base language model. It reads verified
document JSONL splits from the promoted corpus, applies the locked Sero 1
byte-BPE tokenizer, and never crosses document boundaries.

The frozen design and gates are in
`benchmarks/sero1-pretrain-v1/PREREGISTRATION.md`.

Run mechanics checks with:

```sh
make sero1-pretrain-check \
  SERO1_PRETRAIN_PYTHON=build/sero-latent-v3/venv/bin/python
```

The full result is produced only by the bounded AWS route after a successful
calibration.
