# ZERO.4 Q3.2 quantity promotion gate

The frozen Q3.2 package earned promotion eligibility by passing the disjoint
500-row public validation split at 499/500. This gate opens the canonical
500-row promotion sidecar exactly once. It is balanced at 100 examples for
each of the five operations and was excluded from training, private selection,
sentinel evaluation, and public validation.

The unchanged historic quantity thresholds determine go/no-go: at least 99%
closure and syntax; at least 95% operation, arguments, exact request, commit,
and exact artifact; exactly 100% oracle arithmetic; zero rejected state
mutations; and exact non-Q probability identity on the fixed D/H/Z probes.
Per-class statistics are retained for diagnosis but do not replace the frozen
aggregate rule.

This implementation stages mechanics only. A one-shot budget must bind the
exact source commit, public go result, candidate, contract, and promotion split.
The run performs zero training updates. Language evaluation, deployment, and
additional seeds remain sealed under separate authority.
