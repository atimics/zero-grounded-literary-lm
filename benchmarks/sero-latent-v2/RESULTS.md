# Sero Latent v2 results

**Decision: lock the 4,096-entry lossless byte-BPE tokenizer and move Sero to
base-model pretraining.**

The hard stop triggered on all three seeds. V2 passed every engineering and
fairness gate: exact reconstruction, the frozen vocabulary size, raw-byte
exposure within 5%, and estimated compute within 10%. It failed the only gate
that can promote it: held-out bits per raw byte.

| Seed | Conventional BPE | Sero Latent v2 | Difference | Decision |
| ---: | ---: | ---: | ---: | --- |
| 0 | **4.004** | 4.146 | +3.54% | No-go |
| 1 | **3.964** | 4.162 | +4.99% | No-go |
| 2 | **4.013** | 4.205 | +4.78% | No-go |
| Mean | **3.993** | 4.171 | +4.44% | Lock BPE |

## What failed

The direct patch-code prediction itself cost 2.980 bits per raw byte. The
escape path added another 1.095 bits for residual bytes and 0.096 bits for
escape termination. Together they erased the code advantage.

The 4,095 exact codes covered 86.36% of validation patches but only 75.57% of
validation bytes. Rare patches were long—about six bytes each—so the expensive
residual decoder handled a quarter of held-out bytes. Training coverage was
better at 80.71% of raw bytes, showing a real generalization gap in the finite
patch dictionary.

This result is useful. Learned causal boundaries were not a dead idea: V1
proved they reduced boundary cost. But neither a full local decoder nor a
4,095-code dictionary beat direct BPE token prediction. Further tokenizer work
is now outside the agreed evidence budget.

## Next

Freeze the seed-independent byte-BPE artifact used by the control, bind it to
the corpus digest, and use it for Sero 1. The next experiments should measure
language-model scaling on 100 million raw bytes, then one billion raw bytes—not
another tokenizer variant.
