# Reasoner (3,6): language after reasoning

Reasoner (3,6) freezes the passing Reasoner (3,5) tool policy and trains a
separate language readout on completed traces.

The reasoner always finishes first. The language head cannot change a state,
select a tool, or write into reasoner memory. Its controlled sentences are
parsed back and compared with the immutable trace. A deliberately broken
language head must damage the words while leaving the reasoning hash exactly
unchanged.

Run the open screen with:

```sh
make reasoner37-check
./reasoner37 development
```

The sealed command refuses local execution. Cloud execution requires both
`R37_SEALED_EXECUTION=cloud` and a new `R37_EXECUTION_LOCK` path. The source
bundle is frozen at commit `06adde505c47802d80148c0b93ff70b2c749034b`.
Reasoner (3,5) passed its one-shot sealed gate with result SHA-256
`9f00ef30e4a815bbcc88683f74a65c39d62358476f8023bc1ce3d293ccbd2597`.
The exact Reasoner (3,6) bundle, destination, and capped one-shot run are now
authorized with no retry.
