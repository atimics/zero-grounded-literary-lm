# ZERO-EVAL-1 stratified screen results

Source commit: `38e6b8454ed30b8e2cba6d10325d5c1fac4c7729`

| Task | Metric | ZERO.3 | ZERO.4 | Δ ZERO.4−ZERO.3 |
|---|---:|---:|---:|---:|
| BLiMP | raw_accuracy | 0.532000 | 0.537000 | 0.005000 |
| TinyStories | bits_per_byte | 2.527861 | 2.570353 | 0.042492 |
| HellaSwag | normalized_accuracy | 0.271000 | 0.266000 | -0.005000 |
| LAMBADA (adapted) | greedy_exact_accuracy | 0.000000 | 0.000000 | 0.000000 |

AWS launch-relative time: 2502 seconds; estimated compute: $0.4726.

These are one-pass results on the exact frozen 1,000-case stratified samples. They do not represent the unexecuted full suite. LAMBADA uses the preregistered 511-character context adaptation. BLiMP per-paradigm values are descriptive only.
