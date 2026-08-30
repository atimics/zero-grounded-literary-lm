# Reasoner (3,4): one shared policy

Reasoner (3,4) tests whether the passing planning, composition, and
counterexample-order behaviors can coexist in one sixteen-weight policy.

The task-specific code is limited to turning a state and candidate action into
the same sixteen integer feature slots used by its frozen predecessor. There
is no task feature, task classifier, or bank selection. Training cycles one
weight vector through the enabled corpora.

Run the open screen with:

```sh
make reasoner35-check
./reasoner35 development
```

The output reports three pairwise joins, the cyclic three-way join, and a
sequential no-replay control. The task-routed positive control uses 192 bytes;
every joint arm remains 64 bytes.

The sealed command refuses local execution. The cloud wrapper must supply both
`R35_SEALED_EXECUTION=cloud` and a new `R35_EXECUTION_LOCK` path. The sealed
suite is defined in the preregistration and must not be opened during local
development. The AWS contract remains unauthorized until the exact source
bundle, destination, and budget are approved.
