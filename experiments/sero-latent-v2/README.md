# Sero Latent v2

V2 predicts one discrete code per learned causal patch. The 4,095 most common
training patches receive exact codes; one escape code invokes an autoregressive
residual byte decoder. Known codes carry both content and length, while the
escape path preserves every possible byte sequence.

The codebook, boundary threshold, and boundary model use training bytes only.
The three-seed promotion gate is frozen in
`benchmarks/sero-latent-v2/PREREGISTRATION.md`.

```sh
make sero-latent-v2-check \
  SERO_LATENT_PYTHON=build/sero-latent-v1/venv/bin/python

make sero-latent-v2-run \
  SERO_LATENT_PYTHON=build/sero-latent-v1/venv/bin/python
```
