# Q2.9 seed-2 pilot result

Status: **candidate frozen; language gate eligible but not authorized**

Source commit: `c4f682c020e17d6231b6cab5542172f8ef6c1b76`

## Outcome

The preregistered first-hit rule stopped the run at update 50. Quantity
training loss improved 81.0518% from baseline while replay training loss
regressed only 0.12325%, below the 0.75% hard guard. The candidate therefore
passed the training-side Q2.9 selector and no updates 51–100 were committed.

| Update | Quantity loss | Quantity recovery | Replay loss | Replay regression | Rule |
| ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 3.825023 | — | 1.148258 | — | baseline |
| 25 | 1.791715 | 53.1581% | 1.150566 | +0.20106% | continue |
| 50 | 0.724773 | 81.0518% | 1.149673 | +0.12325% | first hit; stop |

The run used 50% of its 100-update cap and 25% of Q2.8's 200-update exposure.
It took 36 observed wall-clock seconds on local hardware and incurred $0.00 of
paid compute.

## Frozen artifacts

- Raw checkpoint SHA-256: `b996514dc947f195723aa8f2ba6a86f3cb937e2c06d5968e3e3f8f65b6e96f86`
  (58,236,384 bytes; not tracked).
- Deterministically quantized candidate SHA-256:
  `018efb1151731f35d10137ee76679d50d62f9bfb344234b54dc418e065abce28`
  (4,920,400 bytes; tracked as `candidate.litq8`).
- Runtime result SHA-256:
  `e4741358825f5a24e278569e0c57ef82e1d83637f2c7063add3be78609239837`.
- Event trace SHA-256:
  `e729b3e7435dec80cfc88a0013a02536d65fad66fa1137dd158d2e66327d2bb6`.

The export was repeated and compared byte-for-byte. The candidate is eligible
for exactly one separately authorized unchanged BLiMP/TinyStories gate. No
language example or score was used during training or selection.

## Authority boundary

This is a training-side candidate decision, not a language-preservation or
promotion decision. The pilot executed no language gate, public quantity
evaluation, promotion evaluation, seed expansion, or deployment. Seeds 1 and 3 remain sealed.
