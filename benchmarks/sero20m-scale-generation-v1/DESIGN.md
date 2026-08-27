# Sero 20M matched scale test

This experiment asks one narrow question: does increasing Sero from 6,021,312 to
20,011,136 parameters create a clear capability gain when the tokenizer, corpus,
context length, curriculum, optimizer, and evaluation method stay fixed?

The primary result is predictive, not subjective. After the staged and retention
training passes, the 20M model must reach at most 1.2620724986051812 test content
bits per byte. That is a five percent improvement over the frozen three-seed 6M
mean. Every source must also remain inside the proven 6M retention envelope.

Generation is a separate matched diagnostic. The exact 6M and 20M checkpoints are
tested on the same held-out documents, context lengths, prompts, decoding settings,
and random sampling seeds. The test reports:

- held-out continuation bits per byte and top-1 token accuracy;
- the gain from 1, 8, 32, and 128 prompt tokens;
- severe repetition and distinct 4-gram rates;
- exact outputs for reasoning, assistant, code, poem, and user-supplied prompts.

Before the 20M output is available, the diagnostic thresholds are frozen to require
five percent lower 128-token continuation loss, at least a 20-point reduction in
greedy and ordinary-sampling loop rates, at least 25 percent higher greedy
distinct-4, and no regression in repetition-penalized loop rate.

The phrase `a mountain is an extremely high space is a flicker` is frozen as a
named prompt. It is intentionally strange: a useful model should continue or
reinterpret it without collapsing into a short loop.

Lower held-out loss is evidence of better prediction. Better samples are evidence
of more usable behavior. Neither one alone proves general intelligence. A step
change requires both a strong quantitative improvement and a visible reduction in
the old repetition and coherence failures.
