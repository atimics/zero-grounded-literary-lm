# ZERO.4-Q2.5 preregistration

Q2.5 changes only what happens after the Q2.4 cumulative guard rejects a
full-size AdamW candidate. The runtime restores weights and moments, then
retries the same frozen minibatch, gradient, proposed update index, and
pre-attempt optimizer state at learning-rate scales `1, 1/2, …, 1/128`. The
first finite trial at or below the unchanged 1.5% cumulative replay ceiling
commits. If all eight trials fail, the outer attempt rejects atomically.

Internal trials do not consume optimizer-attempt budget. Eight consecutive
outer attempts that exhaust all scales stop the active phase. Every trial must
evaluate all six frozen replay slices and appear in `zero.optimizer_attempt.v3`.

The student, initialization, teachers, corpora, routing, optimizer, attempt
budgets, quantity gates, public 2% replay ceiling, checkpoint cadences,
promotion split, and replication policy are unchanged. Seed 2 is the sole
diagnostic run. Promotion and seeds 1 and 3 remain sealed unless seed 2 passes
the existing conjunctive public and promotion outcome.

No Q2.5 training result informed this contract.
