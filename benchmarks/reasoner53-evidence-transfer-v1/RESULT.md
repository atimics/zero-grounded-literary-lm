# Reasoner 5.3 result: pass

The run passed every registered gate. All 72 answers were exact. On the
primary corrupted-evidence condition, the full scorer used 48 candidate checks
against 66 for target-only. That is a 27.3% reduction. It earned twelve
individual wins, exactly matching the gate.

| Condition | Full | Target-only | Untrimmed | Shuffled prior | Oracle |
| --- | ---: | ---: | ---: | ---: | ---: |
| Five clean observations | 24 | 24 | 24 | 24 | 24 |
| Three clean observations | 24 | 24 | 24 | 24 | 24 |
| Three observations, one changed | 48 | 66 | 50 | 79 | 24 |

The full system needed at most six checks in one episode. Ten first suggestions
required correction. The exact seventeen-point verifier produced an exact
answer in every arm and condition. The separately evaluated source-ablation
arm matched target-only in every episode. The 216-byte artifact starts with
the exact 176-byte Reasoner 5.2 source state.

## Scope

The task is a fixed finite polynomial language. The corruption rule changes
one output by one modulo seventeen. The robust loss uses the registered bound
of one changed value. The improvement over the untrimmed arm is two checks in
aggregate. This supports the full registered combination of robust evidence,
source prior, and exact verification on the fixed target family.

Run `reasoner53-20260902t192458z` used source commit
`4dc4444615d4e8d11e44641f81d975542a315be2`. It took 74.263 milliseconds
locally at $0 cloud cost. The execution count is one. Raw files, the learned
artifact, and the consumed lock are bound by `PROVENANCE.json`.
