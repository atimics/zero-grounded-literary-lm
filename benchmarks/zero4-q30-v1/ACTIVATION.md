# Q3.0 routed low-rank adapter implementation

Status: **mechanics complete; pilot run not authorized**.

The staged implementation adds a rank-4 low-rank delta to `w1` and `w2` in
all six transformer layers. ZERO.3 remains immutable. Training constructs
effective Q-only matrices in separate memory, derives gradients for the
low-rank factors, and restores the original pointers without writing a base
weight or optimizer moment.

The candidate package contains the unchanged quantized ZERO.3 artifact plus
the private low-rank factors. Its inference runtime delegates every non-`Q`
token directly to the unchanged legacy inference function. A channel-start
token clears the route; only the following literal `Q` style activates the
low-rank path.

`make zero4-q30-check` verifies:

- finite-difference gradients in the inherited transformer;
- isolated adapter learning with an exact base-state digest;
- zero-initialized adapter identity;
- checkpoint and candidate-package round trips;
- byte-for-byte non-`Q` probability identity against the base runtime;
- a changed `Q` probability trace after an adapter update;
- rejection of the unapproved pilot-budget template;
- preservation of the frozen Q2.7 trainer source hash.

The repository-wide `make check` suite also passes.

There is deliberately no `zero4-q30-train` or `zero4-q30-run` target. A run
requires a separately materialized one-shot budget bound to the exact merged
source commit. The pilot runner consumes that authorization before creating
output and cannot authorize language evaluation or promotion.
