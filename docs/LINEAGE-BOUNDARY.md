# Active model-line boundary

This boundary took effect on 2026-08-23.

## ZERO: active C model line

ZERO is again the active base-model research line.

- literary_lm.c owns float32 training, backward propagation, AdamW, and
  checkpoints in dependency-free C11.
- literary_infer.c owns native and WebAssembly inference.
- export_literary.c writes row-wise int8 matrix weights.
- The deployed .litq8 format is **not integer-only**. It uses int8 matrix
  weights with floating-point row scales, normalization values, and
  activations.
- The immediate work is small-model data, training, and runtime improvement,
  with corpus inputs supplied through cenetex/braid.

PyTorch is not part of the active ZERO engine.

## Sero: frozen CUDA evidence

Sero 0, the latent-tokenizer experiments, Sero 1, Sero 2, and the final 20M
run are preserved as a closed research series. Sero proved that the ordinary
PyTorch/CUDA route can train the same recipe at 20M parameters and improve
held-out compression. It did not solve looping or reliable reasoning.

The Sero .pt artifacts do not run in the C ZERO runtime. Building such a
bridge is not active work.

## Solomon: separate integer-only Rust line

[NSRL](https://github.com/atimics/nsrl) is not a Rust port of Sero. It is the
Solomon integer-only research stack:

- weights are i8 from initialization;
- activations are Q15 i16;
- large reductions and gradient buffers use i64;
- training has no float master weights and is not post-training
  quantization; and
- replay is exact under its fixed arithmetic contract.

Solomon has a strong frozen integer-transformer proof and a successful
successor-v2 result. Its current evidence says the next step is a better
integer objective/proposal operator, not paid p20m scaling.

## ilXyr: evidence plane

[ilXyr](https://github.com/cenetex/ilXyr) registers, verifies, and settles
research evidence. It does not replace the C or Rust model engines.

The clean ownership rule is:

    Braid data -> ZERO C experiments -> ilXyr evidence
               -> Solomon Rust integer experiments -> ilXyr evidence

    Sero PyTorch/CUDA -> frozen evidence or separately paid scale work
