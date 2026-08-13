# ZERO.4 Q3.3 semantic-routing result

Decision: **no-go** for strong semantic generalization. The frozen Q3.2 head
selected the correct operation on 130/500 paraphrased or implicit prompts
(26.0%), versus a five-way chance rate of 20%.

## Accuracy

| Slice | Correct | Rate |
|---|---:|---:|
| add | 0/100 | 0% |
| multiply | 89/100 | 89% |
| add-rational | 24/100 | 24% |
| convert | 7/100 | 7% |
| solve-linear | 10/100 | 10% |
| lexical paraphrases | 73/250 | 29.2% |
| implicit descriptions | 57/250 | 22.8% |
| **overall** | **130/500** | **26.0%** |

Under an independent uniform-chance binomial reference, 130 or more successes
has one-sided probability 0.000683 (z = 3.35). That is evidence of some signal,
not evidence of useful generalization: the preregistered strong threshold was
80%, and four of five class floors failed.

## Confusion matrix

Rows are expected operations and columns are predicted operations.

| Expected \ Predicted | add | multiply | add-rational | convert | solve-linear |
|---|---:|---:|---:|---:|---:|
| add | 0 | 58 | 11 | 31 | 0 |
| multiply | 0 | 89 | 9 | 2 | 0 |
| add-rational | 0 | 71 | 24 | 2 | 3 |
| convert | 0 | 93 | 0 | 7 | 0 |
| solve-linear | 2 | 51 | 37 | 0 | 10 |

The head predicted `multiply` on 362/500 cases (72.4%) and never predicted
`add` correctly. Only 18 of 50 ten-case template cells produced any correct
route; 10 cells were perfect, eight of them multiply cells. Multiply implicit
descriptions were 50/50, while four entire implicit class slices were near or
at zero. This is a brittle surface/template response with a dominant multiply
default, not a learned operation concept.

## Safety and isolation

All 500 model outputs were syntactically closed. The hidden canonical binder
and deterministic oracle were 500/500. Correct routes committed and produced
the exact artifact 130/130. All 370 wrong routes were rejected; rejected state
mutations were zero. Non-Q probability output remained exactly unchanged.
Thus the failure is semantic selection, not arithmetic, syntax, or safety.

## Next improvement

Keep the frozen base, deterministic renderer, binder, and kernel. Train the
same deployment-exact 7,685-parameter head on a balanced mixture of canonical
commands and semantic paraphrases. Balance prompt length independently of
class to eliminate the multiply default. Before training, seal disjoint
template families for selection and final confirmation. Gate jointly on the
existing canonical 1,499/1,500 evidence and on semantic class/stratum floors.

This evaluation consumed its one-shot authorization and performed zero training updates.
Retraining, language evaluation, deployment, and additional
seeds were not run.
