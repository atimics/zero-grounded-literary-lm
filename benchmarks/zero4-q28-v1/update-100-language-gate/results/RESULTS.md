# Q2.8 update-100 diagnostic language gate

Decision: **no-go**

| Screen | Candidate | Frozen threshold | Result |
| --- | ---: | ---: | --- |
| BLiMP raw accuracy | 0.546000 | ≥ 0.522000 | pass |
| TinyStories bits/byte | 2.645309 | ≤ 2.553140 | fail |

The gate used the frozen 1,000-case screens with zero training updates.
The result supports a graded-profile language-safety failure already present by update 100.

This is a mechanism diagnostic only. It cannot revise the final Q2.8 no-go and
does not authorize model promotion or additional training.
