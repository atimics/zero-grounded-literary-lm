# Reasoner 4.2 sealed result

The fresh three-abstraction library-transfer gate **passed**.

- Run: `reasoner42-20260902t030000z`
- Instance: `i-0bb4aacea751e7b92` (terminated)
- Approval: `reasoner42-abstraction-library-2026-09-01-v1`
- Source commit: `a5c8e8c69c309940adce5cb01609b4604e553606`
- Source bundle: 61,608 bytes
- Source SHA-256: `41adde2ab724efc2c41c593b4faa462437108a75cf7ecad0ecc777cb61ebf2e1`
- Contract SHA-256: `373740c1a2bd305e5f57b5b1d6ff0d5d87a6b47d47311e4f544cf14f95a82a6b`
- Execution-lock SHA-256: `6fce8be0136638613c0f48e337fcc12a09389f82768c12d39dfd5903484f6a51`
- Launch-receipt SHA-256: `b179e42736fc0013b9272003dbd75b6d60167ff5d6d3f854f8b2522d16ff1365`
- Result SHA-256: `04abc43c23f26db5114e085906395c508497562ec8b3d90b7da04676a85f47ee`
- Sealed-summary SHA-256: `9c6e091631c893be3f523ac1e06f5e64197ca647d966761d503e1d1e92942e00`
- Final-status SHA-256: `40fd53a5a144331fe806bdcd456d282dee1ef430b4a74896bf2aeee7977d85b4`
- Bootstrap-log SHA-256: `ee4ee1970041b8ce45fd407e283b966324af6adbd99bf8d3ca137a30f0e3bf01`
- Library digest: `3cf6bb033d68d2a3`
- Result digest: `77c0a177ce2ba04f`
- Runtime: 198 instance-seconds
- Estimated EC2 cost: $0.000572000000
- Caps: 2,400 seconds, $0.007 EC2, $0.01 total, no retry

All 34 fresh episodes passed across 17 exact semantic classes and two evidence
orders. Every target required three calls to the frozen learned library and
six expanded base operations. All 14 active queries, 2,754 affine certificate
replays, 102 applications, 34 commits, and 34 reports were exact. There were
no premature commits, and no episode required more than one active query.

The exhaustive base oracle certified the exact six-operation minimum for every
sealed target. The frozen-base, affine, library-discovery, library-freeze,
compression, search-budget, and sealed-minimum certificates all passed. The
semantic oracle passed, while the no-library, shuffled-curriculum, single-use,
curriculum-lookup, and no-query controls all failed as required.

The frozen library searched 820 raw three-call programs. The equivalent
base-only search required 55,987 raw six-operation programs. Across the sealed
episodes, the exact solutions used 51 library tokens rather than 102 expanded
base tokens.

The exact pre-run contract remains unchanged so its recorded SHA-256 stays
auditable. The approved 61,608-byte source object is preserved under S3 version
`R9qZt7EOs_Mgsm5qQfbuGsZZVDcI.i7E` with AES256 server-side encryption. The
permanent execution lock was consumed before launch, this was the only attempt,
there was no post-seal tuning, and the instance terminated after uploading the
result. The machine-readable cloud record is in `CLOUD_PROVENANCE.json`.

Decision: Reasoner 4.2 is positive evidence that exact solved programs can
produce a small frozen library of reusable derived abstractions that preserves
its search advantage on longer held-out compositions inside the registered
reversible affine language. It does not establish arbitrary library learning,
new primitives, non-affine induction, recursion, noisy observations,
natural-language or visual grounding, or open-ended reasoning.
