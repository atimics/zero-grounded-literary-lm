# Reasoner (3,8) cloud result

The sealed exact-law gate **passed**.

- Run: `reasoner39-exact-20260830-16ef417`
- Approval: `reasoner39-exact-law-2026-08-30-v1`
- Instance: `i-0f5c880900de976f5` (`t3.micro`, terminated)
- Source commit: `16ef41706023ae4df417bb562490adf3404292fd`
- Source bundle: 40,342 bytes
- Source SHA-256: `6cc30df918c77800b49b6599f02e39ea6644590ebb32ccb034b93a9bf8cfdb14`
- Source S3 ETag: `2c3d4edc7f2cca960ef8741a9de7d387`
- Source S3 version: `tS7pbHwZCrOC3WKZDYV2E8Wlgw5aZFr7`
- Contract SHA-256: `b88f14bef6f76a944e5ce6aa5eab1d24deb3dc58194fa4390c15cc79c6bc7c47`
- Result SHA-256: `edddc33cedf39fcaecadcb4cd231f7186838f2579d62f2991dddc08dc53b22fd`
- Sealed-summary SHA-256: `c3fe81c40d5c2af8e5307525db47dd579b128b94f010679dfd0c42da1c2d0c78`
- Launch-receipt SHA-256: `24c91ec17d43f604be0ab36233602ba400d13ab7b5b55815769ccef557743c18`
- Final-status SHA-256: `1b9e90ee204a55a70e1f2bf69a0d114799fe945edc0ec74958c4c5a5415cc09c`
- Bootstrap-log SHA-256: `0bf5eb17b99d4faf866c41f2c9bc7f4ef5d9be0cadf23819102f27c9d5e0a874`
- Result digest: `121f8fdebf1f636f`
- Runtime: 335 instance-seconds
- Estimated EC2 cost: $0.000967777778
- Caps: 1,800 seconds, $0.006 EC2, $0.01 total, no retry
- Result prefix: `s3://zero-training-022118847419/experiments/reasoner39-exact-law-v1/reasoner39-exact-20260830-16ef417/`

The learner examined 1,953,125 bounded raw integer laws. Ten passed the exact
certificate and one was the unique primitive minimum-description solution. Its
64-byte policy was:

`[0, 0, 0, 0, 1, 0, -2, -2, 0, -1, 0, -1, 2, 0, 0, 0]`

It made all 743,184 sealed decisions exactly across 20,736 fresh episodes in
dimensions nine through twelve, with zero margin errors. All 145,152
coordinate-permutation checks were exact. The primitive-law, algebraic,
minimum-description, and semantic-oracle certificates all passed.

The zero, shuffled-feedback, and linear-only controls failed as required. An
ordinary perceptron fit its training set but failed the algebraic certificate,
which separates memorized fit from the invariant law recovered here.

Decision: retain Reasoner (3,8) as positive evidence that exact
minimum-description law induction can transfer from raw examples to larger
unseen vector/tool problems. This does not yet establish transfer outside the
registered quadratic family.
