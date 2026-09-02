# Reasoner (3,3,4) cloud result

The sealed witness-order robustness gate **passed**.

- Run: `reasoner34-witness-20260830-344cc33`
- Instance: `i-0fc40067a97d15d3d` (terminated)
- Source commit: `344cc33f58787ef4dd6a6627e7cd55651e1e748b`
- Source SHA-256: `caabe3112b493c2be390b7cbc809bce13dcdbb1842af9cdf9ad6b22cdea1bf96`
- Contract SHA-256: `3bdac34cc94e88e7b982334f31a638dad606901311491b806cd739138bdcecb0`
- Result SHA-256: `80a66260e3ff5ab6cd55c0e37e191899a7a40436b13c3d7efc688be77b835b08`
- Runtime: 516 instance-seconds
- Estimated EC2 cost: $0.001490666667

The 64-byte semantic policy was exact on all 4,095 sealed programs, all
4,877,336 alternate-counterexample decisions, and all 471,040 permutation
checks. The canonical-witness control was robust on only 255 programs;
witness-masked and tool-only controls were robust on none.

Decision: retain this arm as positive evidence that the learned update rule is
independent of verifier witness order rather than memorizing one canonical
counterexample.
