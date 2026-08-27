# ZERO.5-C1 execution notice

The first local execution on 2026-08-23 is invalid and is not a C1 result.

The runner specified the frozen dimensions but did not explicitly select the
literary preset. `zero5_lm` therefore retained the tiny preset's learned
position embeddings. The resulting seed-0 model had 4,984,064 parameters and
learned positions instead of the contract's 4,852,992 parameters and rotary
positions.

The parameter-count guard rejected the attempt after seed 0, before any other
seed ran and before a result file was written. Test metrics remained sealed.

- Rejected checkpoint SHA-256:
  `e0853c38a758127ca335c22a841f90d5d5c4b6c4b58151565015116792af2b47`
- Rejected training log SHA-256:
  `26050bdff6d275aed0379c6bdeac342ddf22167b15cf58b311334578017db204`

The corrected runner explicitly passes `--preset literary`, then applies the
already frozen C1 dimensions. It also checks both the position type and exact
parameter count before accepting a seed.
