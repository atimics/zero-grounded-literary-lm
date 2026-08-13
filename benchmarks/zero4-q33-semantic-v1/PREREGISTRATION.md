# ZERO.4 Q3.3 semantic-routing evaluation

Q3.2 reached 1,499/1,500 across private, public, and promotion cases whose
first word explicitly named the operation. Q3.3 asks the next honest question:
does the frozen head recognize the same operations when that literal label is
removed?

The fixed 500-row dataset is balanced across five operations, two strata, and
five templates per operation/stratum. Lexical rows use familiar synonyms such
as “sum,” “product,” “express,” and “find x.” Implicit rows describe a number-
line move, signed area or scaling, combined fractional amount, equivalent unit
label, or an equation that must balance. Every model-visible input is unique.
The literal words `add`, `multiply`, `convert`, `solve`, and `quantity` are
forbidden from model-visible text.

The model receives only the neutral prior summary and paraphrased input. The
expected class and original canonical command remain hidden. After the model
selects an operation, the canonical command is used solely to verify argument
binding, deterministic arithmetic, safe commit, and artifact correctness. This
isolates semantic routing; it does not test natural-language argument parsing.

Strong generalization requires at least 80% overall operation accuracy, 60% in
every class, 75% on lexical paraphrases, and 65% on implicit descriptions. The
canonical binder and oracle must remain 100%; successful commits and artifacts
must equal correct routes; rejected state mutations must be zero; and non-Q
probabilities must remain exactly unchanged. Five-way chance accuracy is 20%.
The confusion matrix and all 50 ten-example template cells are retained even
if the strong gate fails.

The dataset, mechanics, and thresholds are frozen before the candidate sees a
row. A one-shot budget must bind the exact source commit, candidate, promotion
go result, dataset, and contract. The evaluation performs zero training.
Retraining, language evaluation, deployment, and additional seeds remain
sealed.
