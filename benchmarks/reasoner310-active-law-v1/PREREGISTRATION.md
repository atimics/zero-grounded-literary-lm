# Reasoner (3,9) active-law preregistration

## Question

Can a reasoner construct a small integer program from raw examples, ask for
new evidence while several programs still fit, and then use the unique law for
tool calls in larger unseen dimensions?

Reasoner (3,9) does not receive a distance, feature vector, law identifier,
target coefficient, program identifier, dimension label, or answer label. A
query returns only an integer comparison: less than, equal to, or greater than.

## Program language

The learner receives raw candidate and goal coordinates. Its fixed language
contains only integer load, subtraction, absolute value, multiplication,
nonzero testing, coordinate sum, coordinate maximum, and addition. Programs
are typed postfix trees. Invalid stacks and overflowing programs are rejected.

The learner enumerates programs by description length. Commutative operations
are ordered before comparison. Programs with the same exact ordering over the
registered finite certificate catalogue are one semantic class. The shortest
program is the class representative, with byte order as the final tie-break.

No squared-distance term or other target feature is built into the policy.
Such a term must be constructed as load, load, subtract, duplicate through a
second subtree, multiply, and fold.

## Active reasoning protocol

Each episode hides one canonical law. Initial demonstrations contain raw
vectors and integer comparison results. The learner keeps every program class
consistent with those results.

If more than one class remains, `QUERY` is required. The chosen query minimizes
the largest remaining comparison bucket; ties use the smallest raw probe
index. `COMMIT` is forbidden while two distinguishable classes remain.

After one class remains, the learner uses it for `APPLY` calls on fresh
candidate sets, then calls `COMMIT`. A separate `REPORT` tool renders the
canonical program only after commitment. This keeps law construction, tool
control, and language output in separate phases.

## Curriculum and open screen

The curriculum exposes only canonical one-fold programs in four dimensions.
It teaches the primitive operations, not the composed targets.

The open screen uses 15 canonical two-fold sums in dimensions five through eight.
It changes coordinate order, sign, translation, demonstrations, probes, and
action candidates. Every target program is absent from the curriculum.

The open gate requires:

- exact canonicalization and a unique minimum representative for every class;
- every query to match the registered minimax rule;
- no premature commit;
- exact identification, action, commit, and report calls;
- exact coordinate, sign, and translation invariance;
- a fixed quadratic law to fail;
- a curriculum lookup policy to fail;
- a no-query policy to fail;
- shuffled comparison feedback to fail; and
- a coefficient-only Reasoner (3,8) feature policy to fail.

## Fresh sealed transfer

The sealed generator has a new salt and is not used by development. It uses 31
canonical three-fold sums in dimensions nine through twelve, new initial
demonstrations, new action candidates, six coordinate orders, translations,
and sign reversals. The frozen size is 744 episodes and 2,232 action calls.
Every sealed target is absent from both the curriculum and the open screen.

The sealed gate is exact. Every law must be uniquely identified, every query
and tool action must be correct, every report must name the canonical program,
and every invariance check must pass. A failure is final. There is no retry or
post-seal tuning.

Local sealed execution is refused. A later cloud launch requires a frozen
source bundle, an exact hash, an explicit user authorization, a cost cap, and
a one-shot execution lock.

## Interpretation

A pass would show active, compositional program induction inside this finite
integer language. It would close the main hand-built-feature limitation of
Reasoner (3,8). It would not show discovery outside the registered operators,
natural-language understanding, or open-ended theorem invention.
