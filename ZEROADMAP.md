# ZEROADMAP

ZERO should become a better participant in a channel, not merely a stronger
imitator of literary surfaces. Its unit of experience is therefore a bounded
channel: speakers, reply relations, recent turns, a channel vibe, and a lossy
memory transition.

The parameter budget remains fixed at 4,852,992 until evidence says the
representation and objective have been exhausted. Runtime memory may add
bounded state, but it must be declared separately from learned parameters.

The active faculty-training decision is tracked in `PROPOSALS.md`, with the
completed lineage in `EXPERIMENTS.md`. `ZERO4.md` describes the architecture;
`ZERO4-BACKLOG.md` is subordinate engineering work.

## State of the system — 2026-07-18

| Layer | Concrete artifact | State |
| --- | --- | --- |
| Empty basis | zero-filled storage, finite indices, deterministic seed | built |
| Literary prior | Shakespeare, Blake, Crowley; optional KJV continuation | built |
| Channel representation | speaker roles, reply edges, vibe, summary targets | built |
| Learned memory loop | old memory + recent turns → new lossy memory | built |
| Episodic recall | deterministic 256D flat and partitioned Holo indices | built, partitioned experimental |
| Frozen measurement | `zero-channel-v1`, `zero_eval.c`, pinned hashes | built |
| Browser comparison | transcript, recurrent, flat, partitioned modes | built |
| Logic and Brainfuck curricula | checked logic records plus trace/composition execution records | built, experimental |
| State-composition curriculum | modality-neutral finite-state transition generator | built, experimental |
| Modal curriculum | finite-world reachability and possibility records | built, experimental; follows state composition |
| Quantity faculty | operation-only routing with controller-bound arguments | seed 2 go only; seeds 1 and 3 pending |
| Dialogue training ablation | fixed contract for A/B/C/D candidates | specified, not trained |
| Hidden human channel evaluation | consented, channel-level split | not yet collected |

The deployed browser baseline is `docs/model.litq8` at update 14,500. It is
distinct from the frozen update-16,600 ZERO.3 teacher used for new training.
The browser baseline wins 13/18 transcript-compatible contrasts and 17/24
contrasts with memory targets included. Flat Holo passes 7/8 deterministic
checks; the first partitioned router passes 5/8. Those numbers are a starting
line, not a claim of general language understanding.

## The channel object

A training record has one declared target and a bounded causal history:

```text
channel(style, vibe or old memory)
  message(speaker, optional reply-to, text)
  message(speaker, optional reply-to, text)
  -> ZERO reply

channel(style, old memory, completed recent turns)
  -> new lossy memory
```

Whole channels are assigned to train or validation before records are cut.
An author, play, poem, or channel cannot leak across the split through random
token slicing. Public benchmark prompts never enter training.

## Four-way experiment

The next checkpoint decision is the fixed comparison in
`benchmarks/zero-channel-v1/ablation-contract.json`:

| Candidate | Added relation | Question |
| --- | --- | --- |
| A-flat | none | Is normalized literary text enough? |
| B-turns | speaker-tagged chronological turns | Do explicit speakers help? |
| C-replies | explicit reply edges | Does addressee structure help? |
| D-channel | vibe plus lossy-memory targets | Does the full channel loop help? |

Every candidate starts from the same checkpoint and uses the same architecture,
optimizer budget, held-out source units, and three seeds. Report every seed;
do not promote a lucky run. D-channel advances only if it clears the declared
automatic thresholds, wins a blinded human comparison, and preserves literary
validation quality.

## Execution order

1. Collect a small, consented, multi-speaker channel corpus and freeze its
   channel-level split plus source manifest.
2. Materialize all four representations from those same source channels.
3. Train A/B/C/D for seeds 1, 2, and 3 under the frozen contract.
4. Run `zero_eval` on best and final checkpoints and generate the comparison
   report without hiding failed seeds.
5. Conduct the blinded 200-prompt human reply comparison on held-out channels.
6. Promote only the candidate that clears the contract. If none does, improve
   data relations, memory targets, or routing before adding parameters.

## Commands available now

```sh
make zero-benchmark
make zero-benchmark-check
make web
node tests/test_web_model.mjs
```

`make zero-benchmark` is intentionally slower than sampling because it scores
both alternatives byte by byte through the real quantized C inference path.
The manifest checker refuses to render a report if the benchmark or deployed
model hashes have changed.
