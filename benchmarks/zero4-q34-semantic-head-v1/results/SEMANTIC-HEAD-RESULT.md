# ZERO.4 Q3.4 semantic-head result

Decision: **no-go**. No candidate was frozen, promoted, or deployed.

## Result

The same 7,685-parameter linear operation head was trained from zero on exact runtime features from a frozen 4,852,992-parameter base. Its 9,000-record pool was exactly half canonical requests and half paraphrases. The one-shot seed-2 run stopped at the preregistered 100-update cap without meeting the private semantic selector.

| Update | Private loss | Accuracy | add | multiply | add-rational | convert | solve-linear |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1.6094 | 20.0% | 100% | 0% | 0% | 0% | 0% |
| 25 | 1.5407 | 29.8% | 31% | 15% | 0% | 93% | 10% |
| 50 | 1.4824 | 29.4% | 71% | 35% | 32% | 9% | 0% |
| 100 | 1.3289 | 41.6% (208/500) | 1% | 8% | 49% | 92% | 58% |

The final 41.6% accuracy has a 95% Wilson interval of 37.4% to 46.0%, clearly above the 20% five-way chance rate. Cross-entropy fell 17.4% from initialization and was still falling at the update cap. This is evidence of usable semantic signal, but not of a reliable semantic router. The per-class swings show that the fixed linear decision surface had not found a balanced separation.

The run committed only 6,400 batch examples—0.711 of one pass through the 9,000-record training pool. That makes optimizer underexposure a live alternative to representational failure. Nevertheless, the preregistered claim was the bounded 100-update intervention, and it failed.

Q3.3's untrained semantic benchmark scored 130/500 (26.0%). Q3.4's 208/500 private feature score is a directional improvement of 78 correct routes and 15.6 percentage points, but the datasets use different held-out template banks, so this is not a controlled paired comparison.

## What did not run

Because no measured checkpoint reached at least 80% overall and 60% in every class, the runner correctly skipped packaging, the untouched 500-record semantic confirmation set, all 1,500 canonical regression cases, and non-Q package checks. No result from those sealed gates should be inferred.

## Scaling interpretation

The architecture still scales efficiently to a large language model: for `K` routes and a hidden width `H`, a one-state linear router needs only `K(H+1)` parameters. Five routes over width 4,096 need 20,485 parameters—about 0.00029% of a 7-billion-parameter model. Routing work is proportional to `K*H`, not to the base parameter count, and the base can remain frozen and byte-identical outside the routed channel.

What does not disappear with scale is the base-model forward pass. The model must still read the prompt before the router can inspect its hidden state. The savings are cheap supervised adaptation, deterministic tool selection, no autoregressive boilerplate, and exact isolation—not cheaper prompt prefill.

This run does not validate semantic scaling. It says that a weak 4.85M base plus one linear surface and less than one training epoch is insufficient. A larger pretrained model is a plausible better substrate because its hidden states should encode paraphrase semantics more linearly, but that must be measured on that model. The next target-model test should first cache one or a few late-layer states and compare a linear probe with a small nonlinear head; only then train a routed side adapter if the probe remains class-unstable.

## Scope

This experiment isolates operation selection. After a predicted operation, the evaluator would have supplied a hidden canonical input to the existing binder and arithmetic oracle. It therefore does not establish natural-language argument extraction, open-domain reasoning, or end-to-end natural-language calculation.
