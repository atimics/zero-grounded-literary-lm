# Reasoner (3,3,1) cloud result

The sealed relational-graph gate **failed**. The run is final: no retry or
post-seal tuning is authorized.

- Run: `reasoner34-relational-20260830-dffc367`
- Instance: `i-0506f163d65faadf9` (terminated)
- Source commit: `dffc36771e3a374f381a951fe3e521724c3cc2be`
- Source SHA-256: `e57548b03a25a53edd9b0626d48ab42ee5609a8136e44eec785a39836702c807`
- Contract SHA-256: `9ce291e09a73fef86e026cb34b07e5ba435fcbcf703f0d920e52c2b5bc638ad4`
- Result SHA-256: `967a54e8ef6bb0e7626a938fdc459d83a70d0b32920040a53822def0eb48270e`
- Runtime: 169 instance-seconds
- Estimated EC2 cost: $0.000488222222

The semantic policy solved all 3,888 sealed programs. It produced minimum
traces for 3,880 of them, so eight traces were valid but longer than the exact
minimum. All 1,865,280 evaluated relabeling decisions were exact. Hash,
witness-masked, and tool-only controls solved none of the sealed programs.

Decision: do not promote this arm. Preserve the eight-example minimality miss
as the next relational diagnostic; do not reopen this sealed run.
