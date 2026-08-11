# ZERO.4 Q3.2 pilot result

Q3.2 produced the first runtime-qualified routed operation head. The frozen
candidate is `candidate.litqhead` at update 100. It is not promoted or deployed.

## Result

The deployment-exact private feature gate reached 500/500 at update 100. The
packaged runtime then independently reached:

- operation selection: 500/500 overall;
- add: 100/100;
- multiply: 100/100;
- add-rational: 100/100;
- convert: 100/100;
- solve-linear: 100/100;
- closure, syntax, arguments, exact request, oracle arithmetic, commit, and
  exact artifact: 500/500 each;
- rejected state mutations: 0;
- fixed D/H/Z non-Q probability probes: exact identity with `docs/model.litq8`.

The private feature curve was 20.0% at update 0, 98.6% at update 25, 98.6% at
update 50, and 100.0% at update 100. Cross-entropy fell from 1.60944 to
0.043531. Update 25 missed only add-rational (99/100) and solve-linear
(94/100); update 50 missed add (98/100) and solve-linear (95/100). The
pre-registered per-class floor therefore correctly prevented an early freeze.

## Interpretation

This is a step change, not an optimizer-scale improvement. Q3.0's routed LoRA
reduced its measured loss by only 11.23%. Q3.1's float/batched selector reached
99.6%, but its package fell to 367/500 (73.4%), including 0/100 add. Q3.2 kept
the same 7,685-parameter linear head and training budget, but learned from the
quantized streaming representation used after packaging. The corresponding
package reached 500/500. The failed Q3.1 result was therefore an evaluation-
runtime representation mismatch, not evidence that the frozen base lacked a
usable operation signal.

The claim remains narrow. The records use five balanced templates whose first
input word explicitly names the operation. This result establishes reliable
deployment-path decoding and deterministic request rendering on the contracted
private distribution; it does not establish paraphrase generalization or
implicit mathematical intent recognition.

## Authority boundary

The one seed-2 execution consumed the bound authorization and stopped at 100
updates. Public quantity evaluation, language gates, promotion, deployment,
and seeds 1 and 3 were not run. The next decision is whether to authorize the
existing public quantity gate for this frozen package, followed—only if it
passes—by the non-Q language/promotion gates.
