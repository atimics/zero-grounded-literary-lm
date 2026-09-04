# Reasoner 5.8: compositional behavior transfer

Status: development-only.

Reasoner 5.8 measures exact bottom-up search over unary nonlinear programs in
`GF(17)`. The complete 17-value table defines semantic identity and the exact
verifier. Source depth is at most two. Target depth is three.

The source artifact learns signed Q20 log odds from 64 registered source
families. It contains behavior features, partial-execution signatures, typed
roles, transitions, and a raw-token control table. Its canonical binary format
is little-endian and checksum protected.

The primary development contrast is `full` against `source_free_jit`. The
primary cost is the count of unique canonical semantic partial programs popped
through charged fallback. The formal mechanism contrast is `behavior_off`
against `full`. Four shift results stay visible next to the pooled result.

The controls are `target_only`, `source_free_jit`, `source_ablation`,
`transition_only`, `raw_token`, `behavior_off`, `shuffled_behavior`,
`token_permuted`, `source_only`, `oracle_truth_rank`, and 31 frozen behavior
derangements. Each arm shares the grammar, candidate universe, public evidence,
latent episode, potential responses, verifier, and cap.

The common manifest includes all 64 source tasks, eight calibration tasks,
12 development tasks, and 12 sealed family slots. Scientific execution stays
locked. A later preregistration can supply sealed seeds and execution approval.
