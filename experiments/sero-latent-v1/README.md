# Sero Latent v1

This experiment is a lossless local/global language model, not only a boundary
probe. It compares static byte-BPE tokens with causal entropy-selected patches
under an identical downstream model and training schedule.

Install the isolated dependencies and build the sealed corpus:

```sh
python3 -m venv build/sero-latent-v1/venv
build/sero-latent-v1/venv/bin/pip install \
  -r experiments/sero-latent-v1/requirements.txt
make zero-data-build
```

Run the causal/invertibility/gradient test:

```sh
build/sero-latent-v1/venv/bin/python \
  experiments/sero-latent-v1/train.py --self-test
```

Run the preregistered pilot:

```sh
build/sero-latent-v1/venv/bin/python experiments/sero-latent-v1/train.py \
  --train 'build/zero-literary-v1/text/train/*.txt' \
  --validation 'build/zero-literary-v1/text/validation/*.txt'
```

Artifacts under `build/sero-latent-v1/` are derived caches. The result JSON and
human interpretation belong under `benchmarks/sero-latent-v1/`.
