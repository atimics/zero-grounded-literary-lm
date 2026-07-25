# ZERO-EVAL-1 stratified screen

This is the bounded first external evaluation of the frozen ZERO.3 and ZERO.4
bare language-model cores. It is a screen, not the full suite.

The screen retains all 1,000 frozen TinyStories cases and selects 1,000 cases
from each other task deterministically. BLiMP covers every one of its 67
paradigms with 14 or 15 cases. HellaSwag preserves its two validation splits
with a 498/502 largest-remainder allocation. LAMBADA is a global hash sample.
The hashes and selection rules are frozen in `contract.json`.

Only one AWS c6i.4xlarge execution is authorized. It evaluates both models,
once, with 16 deterministic native workers. The instance is independently
capped at 3,600 launch-relative seconds and $0.68. GitHub Actions only launches
and later collects; it never hosts or waits for the scientific computation.

A reportable result requires all eight model/task records, their frozen input
and model hashes, the complete result aggregate, a structured success status,
and collector validation. A timeout or infrastructure failure publishes no
partial scientific scores.

This screen can support statements only about its exact adapted samples. It
does not support a general LLM claim, a standard full-context LAMBADA claim, or
an inference about the unexecuted full ZERO-EVAL-1 suite.
