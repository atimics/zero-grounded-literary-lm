# Reasoner (3,3,3) cloud result

The sealed composition-transfer gate **passed**.

- Run: `reasoner333-composition-20260830-f746558`
- Instance: `i-04410ebcdd914da23` (terminated)
- Source commit: `f7465586b0133b82c6627162b75df5a28d25883b`
- Source SHA-256: `adaea9a96998c7b13f5eedf8c6a12cb6617aa4f5e35f78dcaee31beae1b22bb6`
- Contract SHA-256: `a6ee11685c21827e29336486c14b0abf56524ff241a796016ee70fc04aa2bcd6`
- Result SHA-256: `b9391354d53c1dbb5a1b3eef790a7f16f74d07c4b27e0740de386ec6f1e58880`
- Runtime: 236 instance-seconds
- Estimated EC2 cost: $0.000681777778

The 64-byte semantic policy produced exact minimum traces for all 63 sealed
three-module, width-three programs and all 252 relabelings. Lookup,
bridge-masked, module-only, and tool-only controls solved zero programs.

Decision: retain this arm as positive evidence that the learned rule composes
across unseen module count and width when the bridge relation is present.
