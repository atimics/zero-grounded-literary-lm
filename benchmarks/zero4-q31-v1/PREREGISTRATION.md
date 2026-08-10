# Q3.1 routed operation-head preregistration

Status: **implementation staged; pilot run not authorized by this file**.

## Decision

Q3.0 proved exact parameter isolation but failed its training selector. Its
rank-4 FFN adapter reduced the four-window quantity loss by 11.2287% after 200
updates, versus the required 80%. Checkpoint analysis showed coherent movement
in all twelve adapted matrices and similar improvement across the four
measured operations. The mechanism was live, but it optimized an
autoregressive character objective for a task whose only learned decision is
one of five operation labels.

The Q3.0 selector was also incomplete: it measured four fixed, overlapping
training windows with identical class order and no `solve-linear` target. Q3.1
replaces both the mechanism and the private selector. It does not reinterpret
Q3.0 as a capacity result.

## Literature boundary

The design is motivated by frozen-backbone classifiers over intermediate
features and by mapping-free classifiers that avoid label-token verbalizers:

- Evci et al. (2022), Head2Toe:
  https://proceedings.mlr.press/v162/evci22a.html
- Chen et al. (2023), Mapping-Free Automatic Verbalizer:
  https://aclanthology.org/2023.findings-emnlp.921/
- Cui et al. (2022), ProtoVerb:
  https://aclanthology.org/2022.acl-long.483/

These sources study larger and mostly different architectures. They motivate
the mechanism family but do not predict this pilot's outcome.

## One changed mechanism

ZERO.3 remains immutable. For a literal `Q` channel only, the hidden state at
the existing target boundary is collected after each of the six transformer
layers. Each 256-dimensional layer state is RMS-normalized and concatenated
into a 1,536-dimensional frozen feature. A zero-initialized linear classifier
maps that feature to five operation classes:

1. `quantity.add`
2. `quantity.multiply`
3. `quantity.add-rational`
4. `quantity.convert`
5. `quantity.solve-linear`

The head has 7,685 trainable parameters: `1536 * 5 + 5`, or 0.158356% of
ZERO.3's 4,852,992 parameters. No ZERO.3 parameter or optimizer moment may
change.

At inference, a finite-state prefix trie converts the five-way posterior into
the existing `@request quantity.<operation> @close` protocol. Shared prefix
tokens receive the sum of the compatible class probabilities; the renderer
does not invent probability one for a class decision. The controller still
binds source arguments and the deterministic kernel still performs arithmetic.

Every non-`Q` token delegates directly to the unchanged ZERO.3 runtime and
must be probability-identical.

## Private split and pilot

The frozen Q2.2 operation corpus contains 9,500 training records, exactly 1,900
per class. Q3.1 uses records 0 through 8,999 as the training pool and records
9,000 through 9,499 as a private internal holdout, exactly 100 per class. Each
feature window contains one record only and ends at its own target boundary;
there are no overlapping multi-record measurement windows.

Only seed 2 may run. The head uses AdamW with learning rate `1e-3`, batch 64,
zero weight decay, and gradient norm clipping at 1.0. The maximum is 100
optimizer updates, with measurements at updates 0, 25, 50, and 100. The first
checkpoint meeting every condition is frozen:

- overall private-holdout accuracy at least 99%;
- every operation accuracy at least 98%;
- all five classes contain exactly 100 holdout records;
- the complete ZERO.3 learned-state digest is unchanged.

Syntax and closure are structural properties of the finite-state renderer and
must be 100% in runtime mechanics tests. Public quantity rows, promotion rows,
BLiMP, and TinyStories cannot influence selection.

If no checkpoint qualifies by update 100, Q3.1 is a no-go. A failed run cannot
be extended. Seeds 1 and 3 remain sealed.

## Claim boundary

The present corpus explicitly names the operation in the first input word.
Passing Q3.1 establishes typed label decoding and exact routed preservation;
it does not establish arithmetic reasoning or implicit semantic routing. Any
paraphrase claim requires a separately preregistered, template-held-out set.

## Authority boundary

This file and its implementation authorize no parameter training, public or
language evaluation, promotion, deployment, or external compute. A one-shot
runtime budget must bind the exact source commit and frozen inputs before the
pilot can execute.
