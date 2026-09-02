# Reasoner 5.0 result

The contract-preserved residual-transfer gate resolved **no-go**.

- Run: `reasoner50-20260902t045030z`
- Decision: `no-go`
- Scientific executions: one
- Scientific retries: zero
- Post-open tuning: none
- Source commit: `1912bba1d6ef29645345fd9ec1792c6586c6e689`
- Source bundle: 72,080 bytes
- Source bundle SHA-256: `3cdd79ed8e735e648d73b0d9db5e2a9f00d2ae60b55e410181fc66fd96e4461c`
- Contract SHA-256: `876bfa3edf82a4894f9bb38b3210ffc281ce4ca3d1533398bac74d4912978360`
- Result SHA-256: `8d0fca3c6d787dcfe330637716fbff7101e1f8d81738d05f6f348166e919c990`
- Execution SHA-256: `5b66095000ed60e9d03684a57fd55da1fc74a86d5e81b9e8a2ccbe88b7e6b51a`
- Frozen artifact SHA-256: `9538a3449d66ec43dc58a139a39fb52392816b7eb3a4e36df798ce602784323b`
- Execution-lock SHA-256: `de8939a0eec2465e393102c67fabc1fbc4921db0abe42fc1433776bbfc16f112`
- Result digest: `68d10269fcbd7ba2`
- Runtime: 893.252 milliseconds
- Cost: $0

The verifier side passed completely. All 24 held-out programs were identified
exactly. All 1,944 affine certificate replays, 72 applications, and 24 reports
were exact, with no premature commit. The unverified scorer's first choice was
wrong in all 24 episodes, confirming that the exact verifier remained
necessary.

The transfer gate failed on search cost:

- full source-plus-residual: 229 expansions;
- target-only: 248 expansions;
- source-only: 187 expansions;
- source ablation: 248 expansions;
- shuffled source: 245 expansions; and
- runtime mismatch: 225 expansions.

The full model improved on target-only by 19 expansions, or about 7.7%, below
the preregistered 20% requirement. It won only 10 of 24 individual episodes,
below the required twelve. It was worse than source-only and slightly worse
than the runtime-mismatch control. Target-only and shuffled-source never
exceeded the 128-expansion budget, so the required budget separation also did
not appear.

Decision: the frozen source artifact contained weak useful signal, because
removing it returned exactly to target-only search cost. But this experiment
does not support the stronger claim that adding a small target residual under
an identical interface produces useful learned-state transfer. Exact interface
matching was reproducible and safe, but it was not sufficient.
