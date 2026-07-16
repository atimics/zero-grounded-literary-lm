# Mathematical foundations of ZERO

## 1. Status of this document

ZERO is a finite character language model implemented in C. Its mathematical
description can be formalized in ZFC, but the C program is not an execution of
the ZFC axioms, and the trained model is not a theorem of ZFC.

The phrase **grounded in zero** has a precise, limited meaning here:

1. begin with the empty set as the canonical representation of zero;
2. construct finite indices, sequences, functions, and machine states from it;
3. introduce distinctions through membership, order, code, initialization, and
   observations; and
4. preserve those distinctions through a finite computation.

Zero is therefore the base of the construction, not its only premise and not
its final state. ZFC supplies axioms; the program supplies operators; the
corpus supplies observations. Without all three, no nontrivial trained model
follows.

---

## 2. From the empty set to finite computation

### 2.1 Zero and the finite ordinals

By the axiom of empty set, there is a set with no members:

$$
0 \;:=\; \varnothing.
$$

Define the von Neumann successor of a set $n$ by

$$
S(n) := n \cup \{n\}.
$$

The finite ordinals are then

$$
\begin{aligned}
0 &= \varnothing,\\
1 &= S(0) = \{0\},\\
2 &= S(1) = \{0,1\},\\
3 &= S(2) = \{0,1,2\},
\end{aligned}
$$

and in general $n=\{0,\ldots,n-1\}$. Thus $i<n$ is represented by
$i\in n$. Distinct natural numbers share the same empty foundation without
being identical: by extensionality, $n\ne S(n)$ because $n\in S(n)$ but
$n\notin n$.

This is the first anti-collapse principle:

> A common ground does not imply a common identity. Difference is carried by
> relation and structure.

The axiom of infinity is required to collect all finite ordinals into
$\omega$. Any particular execution of ZERO, however, uses only finitely many
of them.

### 2.2 Pairs, sequences, and functions

An ordered pair can be represented by the Kuratowski construction

$$
(a,b) := \big\{\{a\},\{a,b\}\big\}.
$$

A function $f:A\to B$ is a set of ordered pairs such that each $a\in A$
occurs in exactly one pair $(a,b)$. A length-$T$ sequence over an alphabet
$\Sigma$ is consequently a function

$$
x:T\to\Sigma,
$$

where $T$ is a finite ordinal. Vectors and matrices are finite functions of
the same kind:

$$
v:d\to K,
\qquad
W:m\times d\to K.
$$

Here $K$ may be an ideal numerical domain such as $\mathbb R$, or the finite
set of IEEE-754 binary32 bit patterns actually manipulated by the C program.
The implementation uses the latter. Its arithmetic is rounded machine
arithmetic, not exact real arithmetic.

### 2.3 The finite-state interpretation

At any instant, a concrete run of ZERO is a finite bit string

$$
s\in\{0,1\}^{N}
$$

for some finite $N$. A C function determines a partial transition

$$
\delta:\{0,1\}^{N}\rightharpoonup\{0,1\}^{N'},
$$

where partiality accounts for allocation failure, invalid input, and other
explicit failure conditions. Every terminating execution is a finite sequence

$$
s_0,s_1,\ldots,s_k,
\qquad s_{i+1}=\delta_i(s_i).
$$

Finite bit strings, arrays, structs, and execution traces all have encodings
inside the hereditarily finite sets $V_\omega$. In this exact sense, the whole
machine execution has a set-theoretic model grounded in $\varnothing$.

This statement is about representability. It does not say that set theory
selects this architecture, corpus, or trained parameter vector uniquely.

---

## 3. Why zero does not become collapse

### 3.1 Empty storage is not an all-zero network

The implementation obtains storage with `calloc`, so its first machine-level
contents are zero-filled. It then deliberately breaks symmetry:

- RMS normalization gains are set to one;
- token embeddings and projection matrices receive deterministic pseudorandom
  nonzero values;
- different array indices consume different pseudorandom values;
- rotary transformations distinguish token positions; and
- distinct corpus symbols select distinct embedding rows and gradients.

The random generator accepts seed zero, but first applies a successor-like
operation, `seed + 1`, followed by a mixing function. A zero internal PRNG
state is explicitly replaced by one.

If all embedding rows and all weights remained exactly equal, then equivalent
units would receive equivalent signals. With zero output logits, for example,

$$
\operatorname{softmax}(0)_a=\frac1{|\Sigma|}
$$

for every token $a$. This is neural collapse by permutation symmetry. ZERO's
zero-filled allocation is only a neutral storage state before the asymmetric
construction begins.

### 3.2 Information cannot arise from zero alone

Let $A$ be a deterministic algorithm. For a fixed program and initial state,
its output contains no uncertainty not already present in its input. In an
information-theoretic notation,

$$
H(A(X))\le H(X).
$$

ZERO's learned distinctions come from several inputs:

$$
\text{trained model}
=A(\text{source code},\text{configuration},\text{seed},\text{corpus}).
$$

The empty set is the common ground of their finite encodings; it is not a
source of Shakespeare, Blake, Crowley, dialogue structure, or numerical
parameters. Training compresses regularities from those observations into a
parameter vector. It does not create them ex nihilo.

---

## 4. The language object

Let the deployed alphabet be the normalized ASCII character set

$$
\Sigma=128=\{0,1,\ldots,127\}.
$$

The values $1$ through $7$ are normally dormant control values and are reused
to express channel structure:

| Value | Mathematical role |
| ---: | --- |
| $1$ | record begins |
| $2$ | message begins |
| $3$ | reply edge; the following token names the replied-to role |
| $4$ | message ends |
| $5$ | record ends |
| $6$ | supervised target begins |
| $7$ | channel summary or lossy memory begins |

A context is a string $x\in\Sigma^T$ with $T\le512$. The tokenizer is a
normalizing map from source text to these finite strings. In the selected
model there are no learned BPE merges; one normalized character is one token.

A channel record is a serialization of a finite relational object

$$
R=(c,m,(r_1,u_1),\ldots,(r_k,u_k),q,y),
$$

where

- $c$ is the channel style;
- $m$ is a compact channel summary or previous lossy memory;
- $r_i$ is a locally anonymized speaker role;
- $u_i\in\Sigma^{<\omega}$ is a message;
- $q$ identifies the role being answered; and
- $y$ is either ZERO's target reply or the next memory.

Speaker identity is local to the record. The reply edge is a relation, not an
assumption that temporal adjacency alone determines dialogue.

---

## 5. The transformer as a finite function

### 5.1 Dimensions

The deployed configuration is

$$
T=512,\quad V=128,\quad d=256,\quad H=8,\quad d_h=d/H=32,
\quad L=6,\quad f=1056.
$$

Its trainable parameter count is

$$
\begin{aligned}
P
&=Vd
  +L\big(4d^2+2df+2d\big)
  +d\\
&=(128)(256)
  +6\big(4(256)^2+2(256)(1056)+2(256)\big)
  +256\\
&=4{,}852{,}992.
\end{aligned}
$$

The terms are the token embedding, four attention projections per layer, two
feed-forward projections per layer, two normalization vectors per layer, and
the final normalization vector. Output weights are tied to the input
embedding, and rotary position encoding has no learned parameters.

### 5.2 Embedding and normalization

For token $x_t$, the initial state is the selected row of the embedding matrix
$E\in K^{V\times d}$:

$$
h_t^{(0)}=E_{x_t}.
$$

For $z\in K^d$ and learned gain $g\in K^d$, RMS normalization is

$$
\operatorname{RMSNorm}_g(z)_i
=g_i\frac{z_i}{\sqrt{d^{-1}\sum_{j=1}^{d}z_j^2+\varepsilon}},
\qquad \varepsilon=10^{-5}.
$$

### 5.3 Rotary causal self-attention

In layer $\ell$, normalize and project:

$$
\begin{aligned}
n_t^{(\ell)}&=\operatorname{RMSNorm}_{g_1^{(\ell)}}
              (h_t^{(\ell)}),\\
q_t&=W_Q^{(\ell)}n_t^{(\ell)},\\
k_t&=W_K^{(\ell)}n_t^{(\ell)},\\
v_t&=W_V^{(\ell)}n_t^{(\ell)}.
\end{aligned}
$$

Each adjacent coordinate pair in every head is rotated according to position
$t$. For pair index $j$,

$$
\omega_j=10000^{-2j/d_h},
\qquad
\operatorname{RoPE}_{t,j}=
\begin{pmatrix}
\cos(t\omega_j)&-\sin(t\omega_j)\\
\sin(t\omega_j)& \cos(t\omega_j)
\end{pmatrix}.
$$

Write $\widetilde q_{t,h}$ and $\widetilde k_{s,h}$ for the rotated vectors in
head $h$. Causal attention assigns zero probability to the future:

$$
\alpha_{t,s,h}=
\begin{cases}
\displaystyle
\frac{\exp(\widetilde q_{t,h}^{\mathsf T}\widetilde k_{s,h}/\sqrt{d_h})}
{\sum_{j=0}^{t}\exp(\widetilde q_{t,h}^{\mathsf T}
\widetilde k_{j,h}/\sqrt{d_h})}, & s\le t,\\[1.2em]
0, & s>t.
\end{cases}
$$

The head output and attention residual are

$$
a_{t,h}=\sum_{s=0}^{t}\alpha_{t,s,h}v_{s,h},
\qquad
r_t=h_t^{(\ell)}+D_aW_O^{(\ell)}
      \operatorname{concat}_h(a_{t,h}),
$$

where $D_a$ is inverted residual dropout during training and the identity at
inference.

### 5.4 Feed-forward block

The second pre-normalized residual block is

$$
h_t^{(\ell+1)}
=r_t+D_fW_2^{(\ell)}\operatorname{GELU}
  \left(W_1^{(\ell)}
  \operatorname{RMSNorm}_{g_2^{(\ell)}}(r_t)\right),
$$

with

$$
\operatorname{GELU}(z)
=\frac z2\left[1+\tanh\!\left(
\sqrt{\frac2\pi}(z+0.044715z^3)\right)\right].
$$

Residual addition is another anti-collapse mechanism: every block begins from
the preceding representation and adds a learned transformation rather than
replacing the state wholesale.

### 5.5 Output distribution

After six blocks,

$$
\bar h_t=\operatorname{RMSNorm}_{g_f}(h_t^{(L)}),
\qquad
z_t=E\bar h_t,
$$

where using $E$ again ties the input and output geometry. The predicted next
character distribution is

$$
p_\theta(x_{t+1}=a\mid x_{\le t})
=\frac{e^{z_{t,a}}}{\sum_{b\in\Sigma}e^{z_{t,b}}}.
$$

Consequently, for a continuation $y=(y_1,\ldots,y_n)$,

$$
p_\theta(y\mid x)
=\prod_{i=1}^{n}p_\theta(y_i\mid x,y_{<i}).
$$

This is ZERO's fundamental language claim: it defines a conditional
distribution over finite character strings. It does not, by this equation
alone, define truth, reference, intention, or consciousness.

---

## 6. Learning

For an ordinary sequence, training minimizes mean next-token cross-entropy:

$$
\mathcal L(\theta;x)
=-\frac1T\sum_{t=0}^{T-1}
\log p_\theta(x_{t+1}\mid x_{\le t}).
$$

For a channel record, let $M\subseteq\{0,\ldots,T-1\}$ contain only positions
inside the target reply or target memory span. The masked objective is

$$
\mathcal L_{\mathrm{channel}}(\theta;x,M)
=-\frac1{|M|}\sum_{t\in M}
\log p_\theta(x_{t+1}\mid x_{\le t}).
$$

The channel header, summary, reply edge, and earlier messages are conditions
through causal attention, but they do not themselves contribute direct loss.
This makes **answer the channel** and **compress the channel** the supervised
acts.

If corpus source $i$ has weight $w_i>0$, it is sampled with probability

$$
\Pr(i)=\frac{w_i}{\sum_jw_j}.
$$

The literary continuation run gives the channel file weight $6$, preventing
the larger raw author streams from defining the task alone.

Gradients are computed by the explicit C backward pass. After mini-batch
averaging and global norm clipping, AdamW uses

$$
\begin{aligned}
m_t&=0.9m_{t-1}+0.1g_t,\\
v_t&=0.999v_{t-1}+0.001g_t^2,
\end{aligned}
$$

with bias correction, $\epsilon=10^{-8}$, decoupled decay on matrix weights,
linear warmup, and optional cosine learning-rate decay. The chosen checkpoint
is selected by held-out loss rather than training loss.

---

## 7. Channel time and lossy memory

An ordinary transformer context grows with the transcript until the oldest
tokens fall out of its fixed window. ZERO instead treats a channel as a
recurrent finite-state process.

Let

- $c$ be a stable channel vibe or style;
- $m_t\in\Sigma^{\le80}$ be the dynamic lossy memory;
- $u_t$ be the next human message;
- $e_t$ be an optional recalled episode; and
- $z_t$ be ZERO's reply.

The reply is sampled from

$$
z_t\sim p_\theta(\,\cdot\mid c,m_t,e_t,u_t\,),
$$

and the next memory is sampled with the same transformer under a different
channel serialization:

$$
m_{t+1}\sim p_\theta(\,\cdot\mid c,m_t,e_t,u_t,z_t,\texttt{SUMMARY}\,).
$$

After $m_{t+1}$ is produced, the completed pair $(u_t,z_t)$ can be discarded
from the active prompt. The state transition is therefore

$$
(c,m_t,u_t)\longmapsto(z_t,m_{t+1}),
$$

with bounded recurrent state rather than an unbounded verbatim transcript.
The compression is intentionally lossy: $m_{t+1}$ is not required to permit
reconstruction of $(m_t,u_t,z_t)$.

This creates two timescales:

1. **working time** — exact tokens inside the current 512-character window;
2. **channel time** — compressed state passed from exchange to exchange.

The stable vibe $c$ gives the channel a prior disposition. The learned memory
$m_t$ gives it a changing history.

---

## 8. Holographic episodic recall

Lossy recurrence may erase a fact that later becomes relevant. ZERO therefore
adds a non-neural, bounded episodic index. It does not change $\theta$.

Define a deterministic encoder

$$
\phi:\Sigma^{<\omega}\to\mathbb R^{256}.
$$

The implementation lowercases and hashes non-stopword lexical features,
prefix features, and adjacent feature pairs. Each hash adds a deterministic
sparse signed vector. The sum is normalized:

$$
\phi(x)=
\begin{cases}
v(x)/\|v(x)\|_2,&\|v(x)\|_2>0,\\
0,&\text{otherwise}.
\end{cases}
$$

At most $32$ episode pairs $(\phi(k_i),m_i)$ are kept in a ring buffer. Given
a new query $q$, exact cosine recall chooses

$$
i^*=\operatorname*{arg\,max}_i
\langle\phi(q),\phi(k_i)\rangle.
$$

The episode is exposed as $e_t=m_{i^*}$ only if

$$
\langle\phi(q),\phi(k_{i^*})\rangle\ge0.22.
$$

Otherwise the index abstains. Recall proposes one older compressed episode;
the transformer remains responsible for answering and for deciding, through
its next summary, whether the echo survives.

This produces a three-part memory system:

$$
\text{exact working context}
\;\oplus\;
\text{learned lossy recurrence}
\;\oplus\;
\text{bounded episodic recall}.
$$

---

## 9. Quantized deployment

Training uses binary32 weights. For browser deployment, each matrix or
embedding row $w_r$ receives scale

$$
s_r=
\begin{cases}
\max_j|w_{rj}|/127,&\max_j|w_{rj}|>0,\\
1,&\text{otherwise},
\end{cases}
$$

and integer entries

$$
q_{rj}=\operatorname{clip}_{[-127,127]}
\left(\operatorname{round}(w_{rj}/s_r)\right).
$$

Inference reconstructs $\widehat w_{rj}=s_rq_{rj}$ during multiplication.
Thus the browser model computes an approximation $p_{\widehat\theta}$ to the
training model $p_\theta$. Quantization changes numerical precision, not the
architecture or parameter count.

Sampling may then apply temperature $\tau>0$, top-$k$ restriction, and a
repetition penalty before drawing a token. These operations alter the
generation policy, not the learned distribution itself.

---

## 10. Formal claims and non-claims

### Proposition 1: finite representability

For any fixed configuration, corpus, seed, step count, and finite memory
capacity, every defined state of ZERO can be encoded as a hereditarily finite
set.

**Reason.** Each component is a finite array of finite-width values, finite
arrays have finite sequence encodings, and finite products and sequences are
constructible from ordered pairs and finite ordinals.

### Proposition 2: bounded online state

With context length $512$, memory length at most $80$, vector dimension $256$,
and episodic capacity $32$, the browser's non-model conversational state is
bounded independently of the number of completed exchanges.

**Reason.** Old working pairs are discarded, the summary length is capped,
and the episodic store overwrites a finite ring.

### Proposition 3: no model from zero alone

The empty set alone does not determine the trained parameter vector.

**Reason.** Many different programs, seeds, corpora, and parameter vectors
have finite set encodings with the same transitive ground. Additional axioms
and data are necessary to select a construction.

### Proposition 4: shared foundation does not force collapse

Two representations constructed over the same empty foundation may remain
distinct whenever their membership, index, token, position, or learned
relations differ.

**Reason.** By extensionality, identity is determined by members, not by the
ultimate ground of the transitive closure. In the network, different indices
select different initialized parameters and receive different data-dependent
updates.

ZERO does **not** claim:

- that ZFC proves this particular trained model;
- that floating-point arithmetic is exact real arithmetic;
- that next-token likelihood is truth or proof validity;
- that a lossy summary is a faithful transcript;
- that cosine similarity establishes semantic identity;
- that a finite literary corpus yields general intelligence; or
- that grounding in the empty set explains consciousness.

The companion finite-set proof generator has a mechanically checked kernel,
but the deployed literary checkpoint is not thereby a theorem prover. Formal
validity must be checked by the kernel, not inferred from fluent text.

---

## 11. The construction in one expression

Let $\mathcal A$ be the finite alphabet, $D$ the finite training corpus,
$\Theta$ the finite machine parameter space, and $U$ the C training
transition. From zero-filled storage $0_\Theta$, deterministic initialization
$I$ breaks symmetry using seed $s$:

$$
\theta_0=I(0_\Theta,s).
$$

Training folds finite observations into the parameter state:

$$
\theta_{n+1}=U(\theta_n,D_{i_n}),
\qquad i_n\in|D|.
$$

The resulting model, together with recurrent memory $m_t$ and episodic store
$E_t$, defines the bounded channel transition

$$
(\theta,c,m_t,E_t,u_t)
\longmapsto
(\theta,c,m_{t+1},E_{t+1},z_t).
$$

The empty set grounds the finite indices and states. The relations in the
program organize them. The corpus differentiates them. Recurrence preserves a
lossy trace of their history. That—not an all-zero parameter vector—is the
mathematical meaning of **ZERO**.
