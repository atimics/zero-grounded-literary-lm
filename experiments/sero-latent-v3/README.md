# Sero Latent v3

V3 is a causal, end-to-end learned chunking experiment. Adjacent contextual
embeddings choose when the expensive global model runs. The global stream is
continuous: there is no patch vocabulary, escape code, or end-patch output.
Both V3 and its BPE control predict the same raw training windows.

The frozen run is complete. Mean final quality was 2.5009 latent bits per byte
versus 2.1835 for BPE. The decision is `do-not-promote-latent-v3`; see
`benchmarks/sero-latent-v3/RESULTS.md`.

The frozen design and promotion rules are in
`benchmarks/sero-latent-v3/PREREGISTRATION.md`.

Install the isolated dependencies and build the corpus:

```sh
python3 -m venv build/sero-latent-v3/venv
build/sero-latent-v3/venv/bin/pip install \
  -r experiments/sero-latent-v3/requirements.txt
make zero-data-build
```

Run the causal, gradient, data-sampling, and exact-BPE tests:

```sh
make sero-latent-v3-check \
  SERO_LATENT_V3_PYTHON=build/sero-latent-v3/venv/bin/python
```

Run the deliberately non-promoting small-corpus smoke test:

```sh
make sero-latent-v3-smoke \
  SERO_LATENT_V3_PYTHON=build/sero-latent-v3/venv/bin/python
```

The completed run is bound to the promoted `sero-pretrain/2026-08-22.v1`
manifest, which contains 123,153,182 unique training bytes. Derived models and
tokenizer files remain in the immutable AWS run prefixes. The verified seed
results, aggregate, and execution receipt are under
`benchmarks/sero-latent-v3/`.

The bounded AWS route uses one on-demand `g5.xlarge` per seed. Its AMI, current
price, wall-clock limits, and $21.126 three-seed EC2 ceiling are frozen in
`benchmarks/sero-latent-v3/aws-execution.json`. Check the launcher with:

```sh
make sero-latent-v3-aws-check
```

Each run also writes a `seedN-dashboard-payload.json` beside its model.
Training does not publish telemetry on its own. After artifact verification,
all three final payloads were published with
`scripts/publish_zero_telemetry.mjs`. The dashboard shows byte loss, BPE
control, learned chunk size, and compute ratio.
