# Q2.2 seed-2 evaluation notice

The replay values in this directory are not admissible for checkpoint
selection. Training used `--sample-weight 1` for all six historical sources,
but the first evaluation adapter removed both distillation and sample-weight
arguments. That restored the trainer's default 2x foundation weight and
changed the frozen replay functional.

The adapter now removes only `--distill`, preserves `--sample-weight 1`, and
has a regression test for the exact route. The corrected baseline is `1.6310`,
matching Q2.1. Corrected selection and the one-time promotion result are in
`benchmarks/zero4-q22r-v1/seed2/`.
