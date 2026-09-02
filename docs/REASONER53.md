# Reasoner 5.3: missing and corrupted evidence

This finite pilot tests the frozen Reasoner 5.2 source prior under three
observation conditions. Each condition contains twelve target programs and
two tie orders.

The clean condition supplies five observations. The partial condition supplies
three. The corrupted condition supplies three with one changed output. The
robust scorer allows one mismatch in the corrupted condition. The full-domain
verifier checks candidate programs over all seventeen inputs.

The primary gate uses the corrupted condition. It requires exact answers,
at least twenty percent fewer candidate checks than target-only, and stronger
results than the untrimmed and shuffled-prior arms. Every episode also has a
64-check budget gate.

The scope is a fixed finite polynomial language and a known corruption limit.
The run saves each episode and each control. See the
[contract](../benchmarks/reasoner53-evidence-transfer-v1/contract.json).
