# Mechanically checked finite-set logic corpus

`logic_corpus` generates compact proof records for the existing character
transformer. Generation is deterministic for a given seed. Each generated
proof is checked before it is written, and `--verify` parses the serialized
file again and checks every result independently of the generator's in-memory
objects.

## Trusted fragment

The logic is intuitionistic natural deduction with implication and
conjunction. Atomic propositions are evaluated in the universe of
hereditarily finite sets. A set is represented canonically by its finite set
of already-constructed elements.

The primitive set terms are:

| Syntax | Meaning |
| --- | --- |
| `0` | Empty set |
| `s(x)` | Von Neumann successor, `x union {x}` |
| `p(x,y)` | Pairing, `{x,y}` |
| `u(x)` | Union of all members of `x` |

Atomic propositions and logical formulas are:

| Syntax | Meaning |
| --- | --- |
| `m(x,y)` | `x` is a member of `y` |
| `q(x,y)` | `x` equals `y` |
| `b(x,y)` | `x` is a subset of `y` |
| `f` | False |
| `a(P,Q)` | `P` and `Q` |
| `i(P,Q)` | `P` implies `Q` |

Proof terms are:

| Syntax | Checked rule |
| --- | --- |
| `h0`, `h1`, ... | De Bruijn-indexed active hypothesis |
| `v(P)` | Validate a true atomic finite-set proposition |
| `ii(P,d)` | Implication introduction under assumption `P` |
| `ie(d1,d2)` | Implication elimination / modus ponens |
| `ai(d1,d2)` | Conjunction introduction |
| `al(d)` | Left conjunction elimination |
| `ar(d)` | Right conjunction elimination |

For example:

```text
@logic hf1
@task prove
@theorem i(a(m(0,s(0)),i(m(0,s(0)),q(0,0))),q(0,0))
@proof ii(a(m(0,s(0)),i(m(0,s(0)),q(0,0))),ie(ar(h0),al(h0)))
@result valid
@end
```

The checker also emits explicitly labelled verification tasks. Invalid proofs
are syntactically well formed but contain an out-of-scope hypothesis, a false
atomic validation, or a valid proof of the wrong theorem.

## Generation

```sh
mkdir -p corpus/logic
./logic_corpus --output corpus/logic/hf.txt --examples 100000 --seed 1
./logic_corpus --verify corpus/logic/hf.txt
```

Check an individual model-produced proof against its requested theorem:

```sh
./logic_corpus \
  --check-theorem 'i(m(0,s(0)),m(0,s(0)))' \
  --proof 'ii(m(0,s(0)),h0)'
```

This prints `valid` only when the proof term is well formed, accepted by the
kernel, and concludes exactly the requested theorem.

Options:

- `--examples N` controls the finite corpus size. New seeds and larger values
  provide an unbounded stream of instances.
- `--max-depth N` controls generated set-expression depth, from 0 through 6.
- `--max-chars N` rejects and regenerates records longer than the limit.
- `--validation-percent N` places structurally different proof templates at
  the end of the corpus. It defaults to 5.

Training templates include identity, constant implication, internal modus
ponens, conjunction exchange, finite-set validation, and implication to an
independently validated fact. The validation tail uses implication
composition, conjunction reassociation, nested projection, and duplication.

## Scope and limitations

This system is a total checker for a finite set-theoretic model, not an
automatic decision procedure for ZF or ZFC. It does not claim that arbitrary
set-theory statements are decidable. The `v` rule is semantic reflection for
closed finite-set atoms; higher-level conclusions must be assembled through
the explicit logical proof rules.

The transformer's validation loss measures next-character prediction, not
formal proof accuracy. Use `logic_corpus --verify` for corpus integrity. A
future task evaluator should parse model completions and report exact theorem
and proof validity separately from language-model loss.
