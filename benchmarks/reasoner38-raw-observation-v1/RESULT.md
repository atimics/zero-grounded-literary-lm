# Reasoner (3,7) sealed result

Decision: **no-go** for the raw-observation dimension-transfer policy.

The one authorized cloud execution opened the seal once. The 64-byte policy
kept its exact open-development result and all preregistered controls behaved
correctly, but it missed 336 sealed decisions. The registered gate required
every decision to be exact, so this result fails. There will be no retry or
post-seal tuning.

## Result

| Measure | Exact result |
| --- | ---: |
| Open-development decisions | 36,720/36,720 |
| Sealed episodes | 15,552 |
| Mixed-domain sealed episodes | 10,368 |
| Sealed decisions | 481,968/482,304 |
| Sealed decision misses | 336 |
| Coordinate-permutation records credited exact | 91,584/93,312 |

The sealed decision accuracy was 99.930334%, but the preregistered threshold
was 100%. The semantic oracle passed. Zero weights, shuffled raw feedback, the
linear-only ablation, and the dimension-bound shortcut all failed as required.

## Interpretation

The result is encouraging evidence that the raw quadratic feature map nearly
transfers, but it rejects the stronger claim that this learned policy is exact
across dimensions six through eight.

A likely cause, not proven by this aggregate result, is that the learned
quadratic coefficients approximate rather than recover the exact invariant.
The frozen candidate-square and candidate-goal weights are -185 and 365;
translation-invariant squared-distance ranking would place the second at 370
for that first coefficient. Linear terms also remain nonzero. The open suite
did not distinguish this approximation from the exact relation, while the
larger sealed suite did.

The next experiment should test an identification method that must recover the
relation from training data exactly, using a fresh seal rather than exposing
or replaying these sealed cases.

## Execution receipt

- Run: `reasoner38-raw-20260830-8e3212a`
- Approval: `reasoner38-raw-observation-2026-08-30-v1`
- Source commit: `8e3212a9770e4514f5f2b1c465c1243c29062cd6`
- Source SHA-256: `95e2c42ec5fcb49635c409be0b4d7eed4022111a99904c2aed65c3b5e01c2bdf`
- Contract SHA-256: `f551dedd1e7e73dee94dae2b417f63703eeb077d048f02047b6cab24996d17eb`
- Launch SHA-256: `71eeb787badcfc65f20a2c061bc4e8bb37a18befe52809eed60690137d98f699`
- Result SHA-256: `0257075d8486bfabde6f51f5dba3c61cea7295858aeb213728f12516c86ea430`
- Sealed-summary SHA-256: `68e60d518beeef8240b75732f9f86cd9624bbbd4c9f7f76aef54cd1cb7c45dcb`
- Result digest: `5a75732bb8933933`
- Instance: `i-0b5313fb45516d51a` (`t3.micro`, terminated)
- Elapsed instance time: 203 seconds
- Estimated EC2 compute: $0.000586444444
- Maximum authorized instance time: 1,800 seconds
- Maximum authorized EC2 compute: $0.006
- Maximum authorized total run spend: $0.01

The launch, status, result, sealed summary, and bootstrap log remain under the
private result prefix
`experiments/reasoner38-raw-observation-v1/reasoner38-raw-20260830-8e3212a/`.
The bootstrap log has SHA-256
`3a45930ba722b7c7afae6e8701c42e2d031b3b40e0af76eb3722d50c3c598991`.
