# ZERO.4 Q3.2 public quantity gate

This gate evaluates the frozen Q3.2 package on the 500-record Q2.2 validation
split. The split is exactly balanced across the five operations and is
disjoint from Q3.2's private selector, which used the last 500 training rows.
The promotion sidecar remains sealed.

Every public row is evaluated exactly once through the packaged operation-head
runtime, faculty controller, and deterministic quantity oracle. The unchanged
historic quantity thresholds apply: at least 99% closure and syntax; at least
95% operation, arguments, exact request, commit, and exact artifact; exactly
100% oracle arithmetic; and zero rejected state mutations. Per-class results
are reported but do not replace the historic aggregate decision rule. Exact
non-Q probability identity is rechecked on the fixed D/H/Z probes.

This implementation stages the gate but authorizes no evaluation. A one-shot
budget must bind the exact source commit, contract, candidate, and public split.
The run performs zero training updates. Promotion, language evaluation,
deployment, additional seeds, and the quantity promotion split remain sealed.
