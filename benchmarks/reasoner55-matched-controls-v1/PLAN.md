# Reasoner 5.5 matched controls

Test whether the fixed task guide reduces exact search work on new families
when all six arms use the same faster hash and sort implementation. Keep the
existing model with SHA-256
`db0afc1e460df5192917fac1f8129a2ec1e753ddb67939a975076fae5579bb7a`.

The arms are target-only search, source-free local guidance, semantic
frequency, task guidance, raw lexical task guidance, and task guidance with
the prior feature removed. Each uses the same compiler, flags, executable,
machine, family order, proposal budget, verifier, and cap. Only the guide
changes. The plain implementation is a local behavior-parity control.

Keep the four earlier family strata. Generate 32 families in each stratum,
with two source views and two tie views per family. Exclude all source and
development target behaviors, their primitive sets, and their declared source
solution syntax. Also exclude the target behaviors and primitive sets of all
128 families in the earlier public fixed-transfer cohort. Reject duplicates
within this new cohort. Preserve the generator's rejection counts.
Composition patterns retain the earlier four-stratum design; freshness here
means new target behaviors and primitive sets within that design.

Use seed `55356d6174636831` for the cloud comparison and
`55356d736d6f6b31` for the local smoke. The local smoke generates one family
per stratum and runs all four views in both implementations. It checks exact
answers, search receipts, operand features, and arm parity. Keep its timing
out of the scientific report.

The full run uses 12 passes. Rotate the six arms across process positions,
then reverse the order for the second six passes. Each pass shares one
deterministic episode shuffle across all arms. Record one warmup and one
measured visit for every episode. Retain both phases, failed episodes, model
loading, family preparation, process CPU, wall time, and peak memory.
The controller stops after a failed child and preserves its raw output and
terminal status. Child timeout is 60 seconds; total controller limit is
45 minutes. A cloud package must also bind its machine and cost ceiling.

The primary comparison is task guidance against raw lexical task guidance.
Report the family-weighted geometric ratios of CPU and `(verifier checks + 1)`.
Use per-episode median CPU across passes, then equal weights for the four
views and the 128 families. Use 5,000 bootstrap draws within the four strata
and the one-sided 95% upper bound. The primary effect requires both upper
bounds below one and every returned answer to pass the exact verifier.
Report the same point ratios and intervals against the other four arms,
the four stratum results, family wins/ties/losses, and total process costs.
This comparison measures the chosen family design and fixed model.

The full run starts from a frozen cloud package after its budget is approved.
The local check is a small engineering diagnostic. Existing results keep
their original source files, hashes, and decisions.
