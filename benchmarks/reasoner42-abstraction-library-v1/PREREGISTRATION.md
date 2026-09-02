# Reasoner 4.2 abstraction-library preregistration

## Question

Can exact solutions to short programs produce reusable derived abstractions
that let the same active learner identify longer held-out programs inside a
fixed search budget?

This is a bounded library-growth question. The learner may compose only the
six registered Reasoner 4.0 adapter operations. A pass is not evidence for an
operation outside that meta-language.

## Frozen base language

The base operations are `reverse`, `rotate-left`, `prefix-sum`, `pair-shear`,
`add-17`, and `multiply-3` over `GF(257)`. The Reasoner 4.0 implementation and
its public development digest `6af623f4d0e176fe` are frozen.

Program identity is strengthened for this experiment. Every program is
compiled to an affine matrix and offset for dimensions four through twelve.
Two programs are identical only when every coefficient and offset is exactly
equal. The inverse certificate must compose to the identity, and the runtime
operation must agree with the symbolic map on the complete affine basis.

## Curriculum and discovery rule

The public curriculum contains nine registered semantic classes with two or
three base operations. The active learner must identify every class before
library discovery.

The discovery rule counts adjacent operation pairs in the canonical solved
programs. It selects exactly three pairs with at least three occurrences,
ordered by decreasing occurrence count and then lexicographically. Each
library entry costs two definition tokens; each replacement costs one token.
The total corpus description must become shorter after definition costs.

The required learned library is:

1. `reverse -> rotate-left`;
2. `prefix-sum -> add-17`; and
3. `pair-shear -> rotate-left`.

Each entry must occur three times, have a positive net MDL gain, possess an
exact affine proof digest, and remain byte-identical after the library freeze.

## Public development screen

Development takes all ordered pairs of learned library entries, expands them
to four base operations, and retains only semantic classes whose exact minimum
is two library calls and four base calls. This gives seven held-out targets.
Each target is evaluated in two deterministic evidence orders.

The exact gate requires:

- all nine curriculum and fourteen development episodes to pass;
- a unique program before every commit;
- exact replay on all 81 zero-and-basis certificate queries;
- three exact decode applications and one exact report per episode;
- no premature commit;
- no more than one active query per episode;
- the 91-program library search to stay within a 100-program budget;
- the corresponding 1,555-program base search to exceed that budget;
- positive curriculum and development compression after library definition
  cost;
- a semantic oracle over the complete base depth-four grammar to pass; and
- no-library, shuffled-curriculum, single-use-library, curriculum-lookup, and
  no-query controls to fail.

## Frozen sealed split

The seal retains exact semantic classes whose minimum description is
three library calls and six expanded base calls. The registered grammar census
contains 820 raw library programs through depth three and 55,987 raw base
programs through depth six. The frozen census contains 17 target classes.

Every target is evaluated in two deterministic evidence orders, for 34 sealed
episodes. The learner may use at most two active queries per episode. A pass
requires all 34 unique identifications and commits, 2,754/2,754 affine-basis
replays, 102/102 decode applications, 34/34 exact reports, and no premature
commit. The frozen library must contribute exactly 51 calls whose expansion
contains 102 base operations.

During the one-shot run, an exhaustive semantic oracle enumerates all 55,987
raw base programs through depth six and must prove that every target has exact
minimum length six. The semantic oracle must pass, while the no-library,
shuffled-curriculum, single-use-library, curriculum-lookup, and no-query
controls must fail.

The evaluator is authorized for one cloud execution under approval ID
`reasoner42-abstraction-library-2026-09-01-v1`. Local execution remains
forbidden. The CLI requires the cloud marker, the frozen approval ID, and a
new exclusive execution-lock file. The execution is capped at 2,400 seconds,
$0.007 EC2 cost, and $0.01 total cost, with automatic termination, no
scientific retry, and no tuning after the seal opens.

## Interpretation

A development pass supports exact discovery and reuse of derived abstractions
inside a registered finite affine meta-language. It does not establish unseen
base primitives, general program synthesis, recursion, noisy learning,
language grounding, or open-ended reasoning.
