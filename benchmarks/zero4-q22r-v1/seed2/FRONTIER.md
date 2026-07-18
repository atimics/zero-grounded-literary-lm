# ZERO.4-Q2.2-R seed 2

Decision: **go**. Selected source update 400 after 100 replay-only updates. Promotion was evaluated once after selection; quantity pass: yes.

| Source update | Repair updates | Quantity pass | Minimum learned-gate margin | Replay loss | Replay regression | Feasible |
| ---: | ---: | :---: | ---: | ---: | ---: | :---: |
| 400 | 100 | yes | 1.000% | 1.6623 | 1.919% | yes |
| 300 | 0 | yes | 0.800% | 1.6613 | 1.858% | yes |

Replay baseline: 1.6310. Repair policy: replay only, fresh optimizer, learning rate 0.000001, no warmup, no cosine decay.
