# Intrinsic arithmetic continuation evaluation

Sero is a base completion model, so this evaluation does not ask whether it
answered a question. A prefix only moves generation toward arithmetic-looking
text. The evaluator then discards the prefix and parses explicit equations from
the generated continuation bytes alone.

The main result must report both equation truth precision and arithmetic yield.
This prevents silence from receiving a perfect arithmetic score. Greedy decoding
measures the most likely continuation. Matched sampling measures arithmetic in
the broader learned distribution.

The one-edit repair diagnostic tests the observed “right pieces, wrong wiring”
pattern. It asks whether a false equation becomes true after one binding edit
using only numbers that appeared elsewhere in the same generated continuation.
This is descriptive evidence about number binding, not credit for a correct
calculation.

Version 1 deliberately uses a narrow, auditable grammar: explicit equations over
signed integers or finite decimals with addition, subtraction, multiplication,
and division. Later versions can add prose facts, units, fractions, algebra, and
multi-equation dependency graphs without changing this frozen result.
