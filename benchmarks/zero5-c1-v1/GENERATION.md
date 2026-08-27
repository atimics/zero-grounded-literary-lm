# ZERO.5-C1 generation diagnostic

These samples were generated after the frozen decision. They did not select a
seed or affect any gate. The prompts are prefixes from the validation format;
the test split remained sealed.

Settings: seed-0 update-300 checkpoint, temperature 0.8, top-k 40, repetition
penalty 1.2, and 96 generated tokens.

## Geography

```text
geography (Q1071)

Description:h
Aliases: erane vgoee , prserlidnlanoma Ae fr  ananoartan i osleaigminn, oal n, otuesumfanhretm  : 782-005
- ocenmnoanreptin, Ser, aac
```

## Johannes Gutenberg

```text
Johannes Gutenberg (Q8958)

Description:R
Aliases: ظσ��: ki, ptsmys bcan
Aliases: n t
Aliases: onir  dlgpfb, pah, t enibe  p of h advdins
Aliases: henru , ondpierhefes, ueggds  oarin yli, ,  u
```

## Association football

```text
association football (Q2736)

Description:hivana ercl, l, pbelonoardnp bcre
Aliases: d  ggpangh m osd sormfar
Aliases: Ean, teua uis mAdasfg  Rinoyarues li ce up
Aliases: tsoy s , bt s,  l
```

The model learned the record shape but not reliable language or facts. This is
a useful negative boundary: lower validation loss on the tiny structured
corpus is real, but it is not enough for coherent generation.
