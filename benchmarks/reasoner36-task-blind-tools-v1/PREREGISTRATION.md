# Reasoner (3,5) task-blind tool routing preregistration

## Question

Can one 64-byte policy route tool calls across planning, composition, and
witness repair after their separate feature builders are removed?

The policy receives one fixed sixteen-integer encoding of candidate tool
calls. The fields have the same meaning in every domain: call kind, query
state, tool-reported validity, progress, remaining obligations, cost,
reversal, and completion. There is no task label, task feature, task
classifier, domain branch, policy switch, or alternate weight bank.

The environment may implement different problems, but it can communicate with
the policy only through the common `QUERY`, `APPLY`, and `COMMIT` protocol.
Candidate handles are opaque and are not policy features.

## Open development screen

Training contains one- through three-stage episodes with variants zero through
five and two handle orders. It includes each domain alone and all six orders
of three-domain mixed episodes.

Development uses disjoint variants six through eleven, four stages, and four
handle orders. It contains 216 episodes: 72 single-domain and 144 mixed. The
policy must make all 4,536 tool decisions exactly.

The open gate passes only if:

- the one shared 64-byte policy is exact on every development decision;
- three separately routed 64-byte policies pass their own domains;
- a zero-weight policy does not pass; and
- rotating tool replies among opaque handles does not pass.

The routed positive control uses 192 active bytes. The shared policy has
sixteen signed 32-bit weights and uses 64 active bytes.

## Sealed combinations

The seal is opened once in the cloud after the source is frozen. It contains
2,592 new episodes with five through seven stages, variants twelve through
twenty-three, and eight handle orders:

- 864 single-domain episodes; and
- 1,728 mixed-domain episodes across all six task orders.

Together these contain 15,552 stage-level handle permutations. Candidate
counts vary from three through five. None of these variants, lengths, or
handle orders appear in training or development.

The sealed gate passes only if the frozen shared policy selects an acceptable
tool call at every decision. A query may inspect any still-unknown handle, and
an apply call may select any tool reply tied for the exact best verified
value. All other calls are errors. Partial success is recorded but is a no-go.

## Interpretation

A pass supports task-blind routing through a common nonverbal tool interface.
It closes the largest interface loophole left by Reasoner (3,4), whose three
separate feature builders could still carry domain knowledge.

It does not establish natural language ability, unrestricted tool discovery,
or general reasoning. The tool protocol and its integer observation fields
remain fixed. Reasoner (3,6) tests the next boundary by freezing this trace and
adding language as a causally downstream readout.

A sealed failure is final. There is no retry or post-seal tuning.
