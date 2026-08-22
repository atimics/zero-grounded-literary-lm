# Sero Latent v2 preregistration

## Question

Can embedding-selected causal patches beat the conventional 4,096-token
byte-BPE Transformer when the global model predicts one discrete patch code,
instead of regenerating every patch byte and end marker?

V1 showed that learned boundaries are useful but its local decoder erased the
gain. V2 changes only the representation of patch content.

## Frozen representation

For each seed, the existing 32-dimensional causal byte model is trained for
200 updates using training bytes only. Its entropy threshold is calibrated on
262,144 training bytes to the frozen byte-BPE rate of 3.62105 bytes per patch.
No patch exceeds eight bytes.

The 4,095 most frequent training patches receive exact discrete codes. Ties are
ordered by raw byte value. Code 4,095 is the escape code. At validation time,
an exact code reconstructs its stored bytes with no local prediction. An
unknown patch uses the escape code followed by an autoregressive byte residual
and an end-patch marker. This makes all byte strings representable exactly.

The global model has a tied 4,096-code embedding, dimension 48, four heads,
four causal Transformer layers, feed-forward dimension 192, and context 16.
Only escape patches run the tied-byte GRU decoder. Each seed trains for 300
updates with batch size 8 and learning rate 0.001.

## Frozen controls and compute

The conventional results were measured before V2 was implemented:

| Seed | Conventional bits/raw byte | Training raw bytes |
| ---: | ---: | ---: |
| 0 | 4.003876 | 139,437 |
| 1 | 3.963666 | 138,966 |
| 2 | 4.012653 | 138,755 |

Both systems see 38,400 patch positions. V2's analytic multiply-add estimate
includes the global 4,096-code softmax and the observed training escape rate.
It must remain within 10% of the conventional control's 313,344 multiply-adds
per patch position. Sampled raw bytes must remain within 5% for every seed.
Tokenizer construction cost is reported separately.

## Hard decision

Promote V2 only if every seed:

1. reconstructs training and validation bytes exactly;
2. uses the frozen 4,096-code vocabulary;
3. passes the raw-byte and compute matching gates; and
4. achieves at least 1% lower validation bits per raw byte than its frozen
   conventional control.

There is no aggregate override and no fourth tuning seed. If any seed fails,
lock the static byte-BPE tokenizer and move Sero to base-model pretraining.
