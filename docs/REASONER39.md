# Reasoner (3,8): exact law induction

Reasoner (3,8) keeps raw integer observations and replaces approximate
perceptron fitting with exact minimum-description law induction.

The learner searches every bounded integer coefficient vector in the fixed raw
polynomial feature map. It selects the primitive vector with the smallest L1
description length that satisfies strict action margins and an algebraic
invariance certificate. The certificate covers translation, sign reversal,
current independence, neutral-dimension extension, and coordinate
permutation. No target coefficient vector is supplied to the search.

Training uses fresh dimensions two through four. The open screen uses unseen
dimensions five through eight, coordinate and opaque-handle orders,
translations, sign flips, near ties, hard raw-error negatives, and mixed-domain
episodes.

Run the open screen with:

```sh
make reasoner39-check
./reasoner39 development
```

The sealed command refuses local execution. Cloud execution requires both
`R39_SEALED_EXECUTION=cloud` and a new `R39_EXECUTION_LOCK` path. The fresh
dimension 9–12 source bundle is frozen at commit
`16ef41706023ae4df417bb562490adf3404292fd`, with SHA-256
`6cc30df918c77800b49b6599f02e39ea6644590ebb32ccb034b93a9bf8cfdb14`.
The seal remains locked until the user explicitly approves that exact source
upload and capped one-shot launch.
