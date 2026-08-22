# Sero Latent v3 results

**Decision: do not promote this V3 learned-tokenizer design. Keep the locked
4,096-entry byte-BPE tokenizer for Sero model training.**

The frozen three-seed experiment completed on 2026-08-22. Every seed used the
same promoted 123,153,182-byte training split, the exact same raw-byte windows
for the latent and BPE arms, and the preregistered 10M, 30M, and 100M-byte
checkpoints. All data, configuration, exposure, and validation gates passed.
The quality gate failed on all three seeds. The compute gate also failed on
seeds 0 and 1.

## Final 100M-byte result

| Seed | Latent BPB | BPE BPB | Latent vs BPE | Learned chunk | Compute vs BPE | Failed gates |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 2.5531 | **2.1839** | +16.90% | 1.92 bytes | 1.428x | Quality, compute |
| 1 | 2.3976 | **2.1839** | +9.78% | 2.56 bytes | 1.174x | Quality, compute |
| 2 | 2.5519 | **2.1827** | +16.91% | 2.95 bytes | 1.082x | Quality |
| Mean | 2.5009 | **2.1835** | +14.53% | 2.48 bytes | 1.228x | Do not promote |

The population standard deviation of the final latent-to-BPE quality ratio is
3.36 percentage points. BPE itself is almost seed-invariant: its final BPB
standard deviation is 0.00058, compared with 0.0730 for the latent model.

## Learning curve

| Raw training bytes per arm | Mean latent BPB | Mean BPE BPB | Mean gap | Mean learned chunk | Mean compute ratio |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10M | 3.2034 | **2.6839** | +19.36% | 2.63 bytes | 1.159x |
| 30M | 2.7879 | **2.3514** | +18.56% | 2.81 bytes | 1.112x |
| 100M | 2.5009 | **2.1835** | +14.53% | 2.48 bytes | 1.228x |

The gap did shrink with more data, but it remained far from the frozen target
of at least 1% better than BPE. The router also became less stable across
seeds. Seed 0's mean chunk length fell from 2.89 bytes at 30M to 1.92 bytes at
100M, while seed 2 rose to 2.95 bytes. The training-only BPE target was 3.356
bytes per token and held-out BPE measured 3.380 bytes per token.

## What passed

- The promoted corpus contains 125,717,691 retained unique bytes, including
  123,153,182 training bytes and 1,316,683 validation bytes.
- Simple English Wikipedia, English Wikibooks, and English Wikinews each
  supplied about one third of every seed's 100,001,792 trained bytes.
- Both arms saw exactly the same raw-byte schedule for each seed. The three
  seed schedules have different recorded SHA-256 hashes.
- Both arms evaluated all 1,316,683 held-out bytes without crossing document
  boundaries.
- The lossless BPE tokenizer, corpus splits, source commit, model artifacts,
  result files, and dashboard payloads all passed hash verification.
- Causality, byte-only output, router-gradient, finite-value, sampling, and
  round-trip tests passed on every AWS host before training.

## What failed

The learned continuous chunks did not preserve language-prediction quality.
Seed 2 is the cleanest proof: its 2.95-byte chunks kept estimated compute at
1.082x control, but quality was still 16.91% worse. The loss therefore cannot
be explained only by over-segmentation.

The router was also unstable. Final chunk lengths ranged from 1.92 to 2.95
bytes, causing estimated compute to range from 1.082x to 1.428x control. Seeds
0 and 1 crossed the frozen 1.15x ceiling. This one-stage ratio loss did not
hold the intended compression rate reliably as language training continued.

Training wall time exposes another practical cost that was not a promotion
gate. The latent model's training step time was 6.29x to 6.89x the BPE model's
step time on the same A10G, even though the declared inference multiply-add
estimate was much closer. The local byte-resolution encoder and decoder are
expensive in the current implementation.

This rejects the exact V3 one-stage embedding router, continuous chunk bridge,
and local upsampling design. It does not show that every learned or latent
tokenizer is hopeless.

## Execution and evidence

The three promotion runs used one on-demand AWS `g5.xlarge` each and cost an
estimated $3.943 total. Training wall time averaged 74.35 minutes per seed.
Calibration cost another $0.112, including one 111-second environment failure
that occurred before training. Total estimated EC2 cost was $4.055.

The source commit was `f899ea6557ed1d85461578ff0b311ed587cc3119`.
The corpus digest was
`6919a2a55495ff3364381d0861f6295412362f6dcf5fff46fda751b779a6d6b6`.
The tokenizer digest was
`eb5063e49af5279ff4552b10b1431c065de3f9a95443d24332d3e52b482de0de`.
Exact instance, cost, S3, result, model, tokenizer, and dashboard receipts are
in [`aws-runs.json`](aws-runs.json). Machine-readable measurements are in
[`aggregate.json`](aggregate.json) and the three `seedN.json` files. The live
AWS dashboard contains all three final seed records.

## Next

Use the promoted corpus and locked byte-BPE tokenizer to train the actual Sero
language-model baseline. That advances the LLM instead of spending the next
budget on another tokenizer repair. Keep latent tokenization as a separate
research branch. A future return should first solve chunk-rate stability and
remove the lossy one-stage chunk-to-byte bridge on a cheap test before another
100M-byte comparison.
