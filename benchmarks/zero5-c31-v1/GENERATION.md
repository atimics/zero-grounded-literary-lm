# ZERO.5-C3.1 generation diagnostic

These samples were generated only after the frozen no-go decision. They did
not select a checkpoint and make no benchmark claim. Prompts are fixed records
from C3 validation, never test. Decoding is greedy with temperature 0, top-k 1,
and seed 0. Claim samples use 48 model tokens, cloze samples use 10, and
retrieval samples use 6.

Checkpoint SHA-256:

- V: `fe44a0713c93b0242705e7be1cfa6288ae6aceb6696ec30e04d8f0d384ed5762`
- A: `40bc7c5de2e00ac91773449b92c050cf05bf4a9c8c535ab3e8c016e33f047f0f`
- B: `bfadb8195c66a22ac3da4da88eb98648f3c60e7beed723c875cbca496fee330b`

## Supported-claim continuations

The first prompt is:

```text
Topic: 0
Section: Computer science
Supported claim: 
```

Its held-out target begins `Many APIs and operating systems ...`.

| Arm | Greedy continuation |
| --- | --- |
| V | `In the United Kingdom is the first powerful power, the first powerful power, the` |
| A | `The first is the second-largest settlement by the second-largest settlement se` |
| B | `The firf is the largest part of the part of the partnersh and the part of the partnersh part` |

The second prompt names section `Symbols and representations`; its held-out
target begins `The digit 0 with a dot ...`.

| Arm | Greedy continuation |
| --- | --- |
| V | `In a person, the person is a person by a person by a person by a person by a` |
| A | `The first is the synon that is the synon by the synon is the synonic by the synonic base` |
| B | `The firf is the largest part of the same time, which is the same time, which is the same` |

None reconstructs or coherently replaces the held-out claim.

## Cloze continuations

| Validation prompt | Expected | V | A | B |
| --- | --- | --- | --- | --- |
| `quadratic [BLANK] ax + bx + c = 0` | `equation` | `Passage BInst` | `particularInstr` | `supportedI` |
| `p and q are [BLANK] to nonzero integers` | `restricted` | `Passage BInst` | `particularInstr` | `particularlyIn` |

Interleaving removed V's obvious retrieval-shaped `Passage B...` intrusion,
which agrees with the exhaustive cloze NLL improvement. These two greedy
answers are still wrong, so they do not establish reliable cloze completion.

## Retrieval continuations

The prompts contain the full instruction and query, balanced 210-code-point
prefixes from Passage A and Passage B, and end with `Answer: `.

| Validation case | Expected | V | A | B |
| --- | --- | --- | --- | --- |
| Archaea, Morphology | Passage A | **`Passage A`** | **`Passage A`** | **`Passage A`** |
| Archaea, Comparison with other domains | Passage B | `Passage A` | **`Passage B`** | **`Passage B`** |

The two-item panel makes A and B look perfect, but the exhaustive 2,023-record
accuracy is 52.25% for A and 54.77% for B. The exhaustive result controls; the
panel only shows that correct retrieval generations exist.
