# Reasoner 5.5 eligible scoring check

Use the four opened matched-smoke families from seed `55356d736d6f6b31`.
Keep the existing 1,863-byte model, both source views and both tie views.
The four arms are semantic frequency, task guidance, raw lexical task guidance
and task guidance with the prior feature removed.

Form semantic groups from public primitive observations and the public example.
Score groups that match that example. Keep the existing feature values and
normalization. Process groups in batches of at most 64. Select at most 64
proposals with a bounded heap, then sort those proposals with the shared comparator.

Compare this implementation with a reference that computes every feature and
sorts every group before selecting the same eligible proposals. Both planners
use the same proposal rule, exact verifier, global cap and canonical fallback.
The verifier challenge uses the first syntactic candidate with a wrong semantic
map. This challenge is common to all four arms and follows planning.

Each arm and planner runs in its own process. Record preparation and complete
process costs, warmups, exact answers, feature work, proposal keys and fallback
work. The small check supplies behavior and work-count evidence. Timing stays
in engineering records. Preserve the earlier matched no-go and its original
challenge and proposal rules as a separate result.

Independently replay every measured episode. Force zero proposal budget, an
empty eligible set and a verifier cap. Check the bounded selection against a
full sort across sizes and score extremes. Keep every failed child and partial
output before checking its status. A fresh scientific comparison follows this
opened check with its own family exclusions, fixed package and budget.
