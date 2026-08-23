# Sero 20M final result

**Decision: pass the frozen scale gates, preserve the evidence, and close the
Sero training line.**

This is the terminal conventional PyTorch/CUDA result for the Sero series. It
shows that the same curriculum and token budget trained a larger dense model
successfully. It does not show reliable reasoning or reliable generation.

## What ran

| Item | Staged run | Consolidation | Total |
| --- | ---: | ---: | ---: |
| Parameters | 20,011,136 | 20,011,136 | 20,011,136 |
| Raw training bytes | 600,008,435 | 400,001,312 | 1,000,009,747 |
| Training tokens | 228,980,479 | 148,050,583 | 377,031,062 |
| Training time | 5,523.44 s | 3,450.37 s | 8,973.81 s |
| EC2 instance time | 5,965 s | 3,867 s | 9,832 s |
| Estimated EC2 cost | $1.6669 | $1.0806 | **$2.7475** |

The full run used one AWS g5.xlarge with an NVIDIA A10G. The total exposure
was 18.84 tokens per parameter.

## Quality

| Model | Parameters | Same training tokens | Test bits/raw byte |
| --- | ---: | ---: | ---: |
| Sero 2 consolidated | 6,018,176 | 377,031,062 | 1.327818 |
| Sero 20M staged | 20,011,136 | 228,980,479 so far | 1.241591 |
| Sero 20M consolidated | 20,011,136 | 377,031,062 | **1.200848** |

At matched total exposure, 20M reduced test bits per raw byte by **9.56%**
relative to the 6M model. The final run passed the overall test gate, the
end-of-document gate, and every frozen per-source gate.

| Final held-out source | Test bits/raw byte |
| --- | ---: |
| English Wikibooks | 1.439361 |
| English Wikinews | 1.375721 |
| GSM8K | 0.939183 |
| MDN Web Docs | 1.023741 |
| OpenAssistant English | 1.236777 |
| Simple Wikipedia | 1.371326 |

## What did not improve enough

Generation remained unreliable. Greedy samples still entered repeated phrase
loops. The arithmetic-shaped sample contained locally false operations. The
model learned stronger surface likelihood and document boundaries; it did not
earn an intelligence or reasoning claim.

That is the useful result: conventional scale worked for compression, while
the observed generation failure stayed visible.

## Frozen evidence

- Contract SHA-256:
  dd52ab69d27f380377b427b53cf963916100e8340e6ec59258ae4bc62603e527
- Result SHA-256:
  cef1a1893912c59277c76ce05b49baa99fe78659322f1057b8052e09b8523d4e
- Final model SHA-256:
  8f3eb73639b14f199170b36df37851a64ad7b9c7dc0779bf98cde3620bbc16ee
- Source commit:
  88a7ad5104a3719f7d99f7d9c1f2cec93863b055
- AWS result prefix:
  experiments/sero20m-consolidation-v1/sero20m-consolidation-full-seed0-20260823-88a7ad5/

The 240 MB model artifact remains in the bound AWS result prefix. The result,
status, parent evidence, and hashes are checked into this repository.
