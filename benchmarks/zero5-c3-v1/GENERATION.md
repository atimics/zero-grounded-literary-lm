# ZERO.5-C3 generation diagnostic

These greedy samples were generated only after the frozen C3 no-go decision.
They did not select the checkpoint and make no benchmark claim. Prompts are
from C3 validation, never test. The C2 and C3 checkpoints use the same frozen
byte-BPE512 tokenizer.

C2 checkpoint SHA-256:

`d6ca2c804f6aded47262060b30ba19e579ec2737e3fab5d0caf40a075148f849`

C3 checkpoint SHA-256:

`ff19965c63db19fda3f179d9ab33b51ce40b3867f288a456a813f9bf4359487d`

Settings: greedy decoding, temperature 0, top-k 1, seed 0. Claim samples use
48 model tokens, cloze samples use 10, and retrieval samples use 6.

## Supported-claim continuation

Prompt:

```text
Topic: 0
Section: Computer science
Supported claim: 
```

Expected opening: `Many APIs and operating systems ...`

C2 continuation:

```text
the beginning is a specific and the basis of the basis of the classicauses the classiis the specific and the
```

C3 continuation:

```text
The first is a series of classical part of the particular classical classes and the particular
```

Neither checkpoint reconstructs the held-out claim.

## Cloze continuations

The first exact validation prompt ends with a blank after `quadratic` in a
sentence containing `ax + bx + c = 0`. The expected answer is `equation`.

| Checkpoint | Greedy continuation |
| --- | --- |
| C2 | `the first classif` |
| C3 | `Passage BInst` |

The second exact validation prompt asks for the word before `to nonzero
integers`. The expected answer is `restricted`.

| Checkpoint | Greedy continuation |
| --- | --- |
| C2 | `the first part of the` |
| C3 | `Passage BInst` |

The C3 retrieval-shaped continuation agrees with the measured cloze-answer
regression and is evidence of last-stage interference.

## Retrieval continuations

These prompts use the exact model-facing view: the full validation instruction
and query, followed by equal 210-code-point prefixes from Passage A and Passage
B, then `Answer: `.

| Validation case | Expected | C2 continuation | C3 continuation |
| --- | --- | --- | --- |
| Archaea, Morphology | Passage A | `the second l` | **`Passage A`** |
| Archaea, Comparison with other domains | Passage B | `the system of` | **`Passage A`** |

C3 learned to emit a valid retrieval answer and gets one example right, but it
chooses A for both. That small panel matches the exhaustive result: 52.05% A/B
accuracy, below the 55% gate and statistically consistent with chance at 95%.
