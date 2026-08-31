# Reasoner (3,7): raw observation before semantics

Reasoner (3,7) replaces the semantic tool fields from Reasoner (3,5) with raw
integer observations. The 64-byte policy sees current, candidate, and goal
vectors plus a raw tool error code. It must learn the quadratic candidate-goal
relation and produce the full `QUERY`, `APPLY`, `COMMIT` trace.

Training is limited to dimensions two and three. The open screen uses unseen
dimensions four and five, coordinate orders, opaque-handle orders,
translations, sign flips, and mixed-domain episodes. A semantic oracle must
pass while zero weights, shuffled feedback, a linear-only model, and a
dimension-bound shortcut must fail.

Run the open screen with:

```sh
make reasoner38-check
./reasoner38 development
```

The sealed command refuses local execution. Cloud execution requires both
`R38_SEALED_EXECUTION=cloud` and a new `R38_EXECUTION_LOCK` path. The source
bundle and cloud contract are locked until the user explicitly approves the
exact upload and capped one-shot launch.

