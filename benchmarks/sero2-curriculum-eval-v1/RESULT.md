# Sero curriculum seed-0 result

## Decision

The curriculum upgrade passed its seed-0 screen after a retention consolidation
stage. Replication seeds 1 and 2 may open. The model is not promoted and should
not be called intelligent: held-out prediction improved sharply, but greedy
generation still loops and sampled answers are often fluent but wrong.

## What changed

The corpus grew to 161,955,325 unique UTF-8 bytes using the existing Wikimedia
sources plus pinned MDN, reviewed English OpenAssistant, and GSM8K. The builder
removed repeated paragraphs, exact and near duplicates, and every training
document with an exact 12-word overlap against held-out data or the frozen
semantic panel. An independent rebuild produced the same dataset digest.

The 6.02M-parameter model first trained through foundations, breadth, and
application over 600,008,435 raw bytes. That learned the new sources but left
the original sources underexposed. A hash-bound 400,001,312-byte consolidation
then used 60% foundation, 30% news/general, and 10% continued replay of the new
domains. No architecture or tokenizer changed.

## Complete held-out test

| Source | Control BPB | Consolidated BPB | Change |
| :--- | ---: | ---: | ---: |
| Overall | 1.7115 | **1.3278** | **-22.4%** |
| Wikibooks | 1.5656 | **1.5551** | -0.7% |
| Wikinews | **1.4825** | 1.4921 | +0.6% |
| Simple Wikipedia | **1.4934** | 1.5004 | +0.5% |
| MDN | 2.2390 | **1.1617** | **-48.1%** |
| OpenAssistant | 1.6123 | **1.3463** | **-16.5%** |
| GSM8K | 1.8362 | **1.0730** | **-41.6%** |

All seven frozen loss/retention gates passed. Test end-of-document top-1
accuracy rose from 0% on the transformed curriculum documents to 89.2%.

## Does it use longer context?

The same 64-token continuations from 24 held-out documents were scored with
different amounts of real preceding context.

| Prompt tokens | Control BPB | Consolidated BPB | Consolidated top-1 |
| ---: | ---: | ---: | ---: |
| 1 | 2.0473 | **1.7272** | 38.7% |
| 8 | 2.0061 | **1.6743** | 39.9% |
| 32 | 1.8753 | **1.5769** | 42.8% |
| 128 | 1.7693 | **1.4325** | 46.4% |

For the consolidated model, 128 tokens lowered continuation loss by 0.2947 BPB
relative to one token. The gain occurred in 23 of 24 paired cases, with a 95%
normal-approximation interval of -0.3741 to -0.2152 BPB. This is evidence of
useful context conditioning, not evidence of reasoning.

## Generation reality check

Across ten multi-domain prompts, greedy severe loops fell only from 100% to
90%. Sampling at temperature 0.8, top-p 0.9, and repetition penalty 1.1 reduced
the loop rate to 5% across 20 sampled outputs and raised distinct-4 to 96.6%,
but sampled factual and math answers were still unreliable. For example, the
model formatted a simple ball-counting problem like a worked solution but
returned the wrong number.

The data curriculum therefore delivered the intended step change in language
modeling and domain coverage. It did not solve generation collapse or produce
reliable intelligence. Those remain scale-and-training-objective problems, and
must be measured separately from decoding.

## Reproducibility and cost

- Dataset digest: `dcad26c0cc44f449d87eb8af0d62d0518dc120a62aad049ff541c2fc149a35d8`
- Passing model: `0d68e038d25bc639bf0751373aeb182042c138aefb64eedbb3b529b1da1b7ea7`
- Passing result: `278481f8324b407efcf188f5ae367af3213c8df8481c2fa795da60ebf47347bf`
- Corrected comparison result: `794e7a2c21195ba0e93abeb8aabe464344bff43636512334d1cd4dae95b07508`
- Exact staged schedule: `79139c590c044befe176e818210baf82b311393c8dffa3fcb203317a2053215f`
- Exact consolidation schedule: `c889af19be110b9fd905bb7fec6679fb1eda01cb27911b6e5b883e35c54b33d0`
- Total measured AWS EC2 cost: `$1.719701111111`

The full training evidence remains in the immutable S3 experiment paths named
in the AWS status artifacts. The corrected comparison bundle is under
`s3://zero-training-022118847419/experiments/sero2-curriculum-eval-v1/seed0/794e7a2c21195ba0e93abeb8aabe464344bff43636512334d1cd4dae95b07508/`.
The summary JSON beside this report contains the compact machine-readable
decision.
