# ZERO.5-C2 generation diagnostic

These samples were generated only after the C2 decision. They did not select
the checkpoint and make no benchmark claim. The checkpoint, tokenizer, prompt,
sampling settings, and output are shown so the qualitative result is auditable.

Checkpoint SHA-256:

`d6ca2c804f6aded47262060b30ba19e579ec2737e3fab5d0caf40a075148f849`

## Standard sampler

Settings: 128 model tokens, temperature 0.8, top-k 40, repetition penalty 1.2.

### Prompt: `The history of astronomy begins with`

```text
The history of astronomy begins with sfoundeffiction (PDE) and spokas was a paper card, casting in grain from this status which begin was law in lower in administered resistance that in distanced less. Although scape fungi marcel is derivable to their
```

### Prompt: `In mathematics, a proof is`

```text
In mathematics, a proof is, by that a tree second (including "standard"burnification" began in an "twentilli" (or "prececalculate"B (since the pest crop on the theoretical state of classifdams; there are axremain to simped. Agricultural damage is ten
```

### Prompt: `A mountain is`

```text
A mountain iswh from gene."Enterm is not an associated wi a space into the great govern and steep in the center. Systems including a group of film that ey.

### In later or a kintery of prevent division, as it was into craft throughout the gover
```

### Prompt: `A short poem about winter:`

```text
A short poem about winter:
ot soluches the while responsito a statute. The firs seem which have many centers and when each later is used to part up microbins. The each corrust rejects to produce discoveries and a luminating from sother tra
```

## Conservative held-out-prefix check

Settings: 128 model tokens, temperature 0.3, top-k 10, repetition penalty 1.1.
The prompt is the opening of an Atlas validation article, not a test article.

### Prompt

```text
# Pop music

Pop music, or simply pop, is
```

### Output

```text
# Pop music

Pop music, or simply pop, is, is a classiep must be used to be a separate or a separate specific which is a separate and some between their can both which is seen as a specific and sometimes can be still by the field of the largest person by the
```

## Interpretation

C2 is visibly beyond C1's mostly marker-shaped gibberish: it has learned prose
rhythm, headings, punctuation, and topic-like vocabulary. It still invents
broken words, repeats templates, and fails to sustain meaning. Lower sampling
temperature does not fix those defects, so they are model/data limitations
rather than sampling noise alone.
