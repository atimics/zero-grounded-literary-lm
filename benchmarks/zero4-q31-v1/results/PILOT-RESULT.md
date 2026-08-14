# Q3.1 seed-2 routed-head pilot result

Status: **private float selector go; packaged-runtime no-go**.

The one-shot pilot bound to source commit
`75b70f25e7ed04c43b03f62befbe96f56bac25e8` trained the 7,685-parameter
all-layer operation head through the 100-update ceiling. The frozen float
training runtime met the preregistered private selector at update 100. A
post-selection audit of the self-contained quantized runtime on the same 500
private records did not preserve that accuracy, so the package is not eligible
for public quantity, language, promotion, or deployment gates.

## Frozen-float selector

| Update | Cross-entropy | Overall accuracy | add | multiply | add-rational | convert | solve-linear |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 1.609438 | 20.0% | 100% | 0% | 0% | 0% | 0% |
| 25 | 0.854733 | 79.2% | 39% | 100% | 96% | 95% | 66% |
| 50 | 0.425464 | 97.0% | 98% | 100% | 99% | 100% | 88% |
| 100 | 0.139881 | 99.6% | 100% | 100% | 100% | 100% | 98% |

Every measurement used exactly 100 private records per class. Update 100 met
the 99% overall and 98% per-class thresholds. The complete ZERO.3 learned-state
digest remained `0af92f28cdc3c69b`.

## Packaged-runtime audit

The selected checkpoint was packaged with the immutable quantized
`docs/model.litq8` runtime and evaluated on the same 500 private records.

| Runtime metric | Result |
| --- | ---: |
| closure | 500/500 |
| syntax | 500/500 |
| operation / exact request | 367/500 (73.4%) |
| bound arguments | 500/500 |
| deterministic oracle | 500/500 |
| committed exact artifact | 367/500 (73.4%) |
| rejected state mutations | 0 |

Per-operation runtime accuracy was:

- add: 0/100
- multiply: 100/100
- add-rational: 100/100
- convert: 100/100
- solve-linear: 67/100

The finite-state renderer therefore worked exactly, but the selected operation
did not. Private examples showed `add` routing primarily to `add-rational`,
with some routing to `multiply`.

Three non-`Q` probability traces (`D`, `H`, and `Z` styles) remained exactly
identical to the immutable base runtime.

## Interpretation and decision

The head architecture produced the intended step change in the frozen float
training environment: 99.6% accuracy after 100 updates with 87.8% fewer
trainable parameters than Q3.0. The deployment package exposed an unmodeled
representation boundary. The trainer extracted features from the float
teacher using the batched training implementation, while the package extracted
features from the quantized streaming implementation. The class-specific
collapse is consistent with a feature-coordinate shift across those two paths;
this is an inference from the paired result, not a separately isolated causal
measurement.

Q3.1 is closed as a runtime no-go. The update-100 checkpoint and package are
retained as diagnostic artifacts only. The consumed pilot must not be rerun.
The next experiment must train and select the head on deployment-exact,
quantized streaming features and validate the packaged runtime inside the
selector before candidate freeze.

## Artifact hashes

- authorization: `dc57e820d2fab4949a0a8d3165991d565520f020c062b742ba804ee8e73879dc`
- raw events: `c46317f17200c9bfc38a0f6712418eaeb7057aaef4b3517a0f3c2a8a2a749ac3`
- raw selector result: `62f9ad597ec67c9d6e87128a4ccd3166a460fe3651ec6678c5a59ace067a5fbc`
- update-100 head checkpoint: `faa78f9d56e64f75461d1d8ebffd00669d1aff1a58d874d611042e7987ec24c5`
- packaged diagnostic candidate: `84c67ea546383be82d85b16f4be0e5e9a3d2d3641c7f0ca928a96d652a21d452`
- packaged-runtime private audit: `3cfd744a8ac53f6eaae9bb7b66ada532f451c87dee8fb8e4056fda40adf04478`

Public quantity, language, promotion, and deployment evaluations were not run.
Seeds 1 and 3 remain sealed.
