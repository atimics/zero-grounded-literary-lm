# Reasoner 5.4: a synthetic pixel channel

The registered decision is no-go. The decoder recovered all 288 field symbols,
and all 48 final answers were exact. Full and target-only both reached the
one-check floor. See the
[result](../benchmarks/reasoner54-pixel-transfer-v1/RESULT.md).

This finite pilot carries the symbolic source prior through a small image
channel. Each field value has a four-by-four binary glyph. The sensor rotates
each glyph and flips its light and dark pixels. Seventeen labelled glyphs
train a template decoder before the target programs are opened.

Each target supplies three input-output pairs as pixels. One condition uses
clean pixels. The other flips one pixel in each glyph. The decoder requires a
six-pixel distance margin. The source prior orders candidate programs from the
decoded pairs. Exact equality over all seventeen field inputs decides the
final answer.

The primary gate uses the pixel-error condition. It compares the full system
with target-only, shuffled source state, the original symbol templates, and
an oracle symbolic channel. Every episode is recorded.

The scope is a synthetic sensor with a fully labelled seventeen-symbol
alphabet. It provides a small test of the path from pixels through a learned
decoder to verified program search. See the
[contract](../benchmarks/reasoner54-pixel-transfer-v1/contract.json).
