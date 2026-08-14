# ZERO.4 Q3.2 deployment-exact head pilot

Q3.1 proved that a 7,685-parameter linear head can decode all five operations
from frozen ZERO.3 representations, but its float, batched selector overstated
the packaged quantized streaming runtime: 99.6% internally became 73.4% after
packaging. Q3.2 changes only the representation source and the authority that
freezes a candidate.

Before any optimizer update, Q3.2 replays records 0 through 9,499 through the
deployment package's quantized, token-by-token Q route. It copies the six
RMS-normalized 256-dimensional layer outputs at the target boundary. Records
0 through 8,999 are the training pool; records 9,000 through 9,499 are the
private selector, exactly 100 per class. Records 9,500 through 9,999 are public
and are not replayed or scored.

The head, seed, batch size, learning rate, update cap, and measurement schedule
remain unchanged from Q3.1. A feature-space hit is necessary but insufficient.
The runner packages the first hit and evaluates that package on the same 500
private records. Freeze requires at least 99% overall operation accuracy, at
least 98% in every class, exact closure/syntax/arguments/oracle behavior, zero
rejected state mutations, and byte-exact non-Q probability output on the fixed
D/H/Z probes.

This document and the contract stage mechanics only. The pilot run is not
authorized by the repository. A user-issued one-shot budget must bind the
source commit and contract hash. Public quantity evaluation, language gates,
promotion, deployment, and seeds 1 and 3 remain sealed.
