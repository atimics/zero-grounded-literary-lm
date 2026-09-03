# Reasoner 5.4 result: no-go

The sensor path completed its registered task. It decoded all 288 pixel glyphs
correctly. The smallest classification margin was six pixels. All 48 final
program answers were exact. The full system matched the symbolic-channel
oracle at one candidate check per episode.

The ranking gate recorded no-go. Target-only also needed one check per episode,
so the task supplied zero ranking headroom. The full system earned zero
individual ranking wins against a gate of twelve. Every first suggestion was
already exact, while the gate required at least one verifier correction.

| Condition | Full | Target-only | Shuffled prior | Original templates | Oracle |
| --- | ---: | ---: | ---: | ---: | ---: |
| Clean pixels | 24 | 24 | 26 | 5,407 | 24 |
| One changed pixel per glyph | 24 | 24 | 26 | 3,837 | 24 |

The original-template control shows that calibration caused the successful
channel recovery. The calibrated full system and oracle had identical search
cost. The next pixel experiment needs ambiguous program evidence so source
ranking has measurable room above one check.

## Scope

This is a synthetic four-by-four binary sensor. Calibration uses one labelled
template for every field symbol. The target programs come from the fixed
finite polynomial language. This result supports exact transfer through this
calibrated channel. It gives a clear task-design requirement for the next
grounded test.

Run `reasoner54-20260902t192458z` used source commit
`4dc4444615d4e8d11e44641f81d975542a315be2`. It took 47.938 milliseconds
locally at $0 cloud cost. The execution count is one. Raw files, the learned
artifact, and the consumed lock are bound by `PROVENANCE.json`.
