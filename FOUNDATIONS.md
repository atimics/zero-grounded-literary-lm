# Mathematical Foundations of ZERO

## 1. Status and scope

ZERO is a finite character language model implemented in C. Its mathematical
description can be formalized within Zermelo-Fraenkel set theory with Choice
(ZFC), but the C program is not an execution of the ZFC axioms, and no trained
checkpoint is a theorem of ZFC.

The phrase **grounded in zero** has a precise meaning:

1. Begin with the empty set ∅ as the canonical representation of zero.
2. Construct finite ordinals, sequences, functions, and machine states from ∅
   using only the operations of ZFC.
3. Introduce distinctions through membership, order, code, deterministic
   initialization, and observed regularities in a corpus.
4. Preserve those distinctions through a finite computation whose state
   transitions are set-theoretically representable.

Zero is the base of the construction, not its only premise and not its final
state. ZFC supplies the axioms of construction. The C program supplies the
operators. The corpus supplies the observations. Without all three, no
nontrivial trained model follows.

---

## 2. The set-theoretic ladder

### 2.1 Zero and the finite ordinals

**Axiom of Empty Set.** There exists a set with no members.

$$
\exists x\,\forall y\,(y\notin x).
$$

By extensionality this set is unique. We define

$$
0:=\varnothing.
$$

**Definition 2.1** (von Neumann successor). For any set $n$,

$$
S(n):=n\cup\{n\}.
$$

**Definition 2.2** (Finite ordinals). The class of finite ordinals is the
smallest class containing $0$ and closed under $S$:

$$
\begin{aligned}
0&=\varnothing,\\
1&=S(0)=\{\varnothing\}=\{0\},\\
2&=S(1)=\{\varnothing,\{\varnothing\}\}=\{0,1\},\\
3&=S(2)=\{0,1,2\},
\end{aligned}
$$

and in general $n=\{0,1,\ldots,n-1\}$.

**Theorem 2.3** (Anti-collapse by membership). For every finite ordinal $n$,
$n\neq S(n)$.

*Proof.* By construction, $n\in S(n)$ because $S(n)=n\cup\{n\}$. If
$n=S(n)$, substitution gives $n\in n$. But membership on finite ordinals is
irreflexive: every member of $n$ is a strictly smaller ordinal. Equivalently,
Foundation forbids the singleton membership cycle $n\in n$. Hence
$n\neq S(n)$.

This is the **first anti-collapse principle**: a common ground does not imply
a common identity. Distinctness arises from membership relations, which are
the first structure built upon ∅.

**Remark.** The Axiom of Infinity is required to collect all finite ordinals
into the set $\omega$. Any particular execution of ZERO uses only finitely
many finite ordinals, so Infinity is not needed for the representability claims
in this document. It is included for completeness of the mathematical
description.

### 2.2 Ordered pairs and Cartesian products

**Definition 2.4** (Kuratowski pair). For any sets $a,b$,

$$
(a,b):=\{\{a\},\{a,b\}\}.
$$

**Theorem 2.5** (Pairing property). $(a,b)=(c,d)$ if and only if $a=c$ and
$b=d$.

*Proof.* Standard; follows from the Kuratowski encoding and extensionality.

**Definition 2.6** (Cartesian product). $A\times B:=\{(a,b):a\in A,\;b\in B\}$.

### 2.3 Functions as sets of ordered pairs

**Definition 2.7** (Function). A set $f$ is a function from $A$ to $B$,
written $f:A\to B$, if:

1. $f\subseteq A\times B$,
2. for every $a\in A$ there exists exactly one $b\in B$ with $(a,b)\in f$.

We write $f(a)=b$ for $(a,b)\in f$.

**Definition 2.8** (Sequence). A finite sequence of length $T$ over alphabet
$\Sigma$ is a function $x:T\to\Sigma$, where $T$ is a finite ordinal.

Thus $x=(x_0,x_1,\ldots,x_{T-1})$ with $x_i\in\Sigma$. The set of all finite
sequences over $\Sigma$ is $\Sigma^{<\omega}:=\bigcup_{T\in\omega}\Sigma^T$.

**Definition 2.9** (Vector and matrix). A $d$-dimensional vector over field
$K$ is a function $v:d\to K$. An $m\times d$ matrix is a function
$W:m\times d\to K$.

Here $K$ is either the ideal field $\mathbb R$ (in the mathematical
specification) or the finite set of IEEE 754 binary32 bit patterns (in the C
implementation). The implementation arithmetic is rounded machine arithmetic;
the specification uses exact real arithmetic. Where the two diverge, we note
the divergence explicitly.

### 2.4 Hereditarily finite sets

**Definition 2.10** (Transitive closure). The transitive closure of a set $x$,
denoted $\operatorname{TC}(x)$, is the smallest transitive set containing $x$.

**Definition 2.11** (Hereditarily finite). A set $x$ is hereditarily finite if
$\operatorname{TC}(x)$ is finite. $V_\omega$ denotes the class of all
hereditarily finite sets.

**Theorem 2.12** (Representability of finite computation). Every finite bit
string $s\in\{0,1\}^N$, every finite-dimensional array of finite-precision
values, and every finite execution trace of a terminating C program has an
encoding as an element of $V_\omega$.

*Proof sketch.* A bit $b\in\{0,1\}$ is encoded as $\varnothing$ (for 0) or
$\{\varnothing\}$ (for 1). A bit string of length $N$ is a sequence, i.e., a
function $N\to 2$, which is a set of ordered pairs. Ordered pairs, functions,
and finite ordinals are all constructed from ∅. Arrays are products of
sequences. Execution traces are finite sequences of finite machine states,
each of which is a finite tuple of finite values. All constructions remain
within $V_\omega$.

This theorem establishes that ZERO's entire execution—every initialization,
forward pass, backward pass, parameter update, and channel transition—has a
set-theoretic model whose transitive closure bottoms out at ∅. The
representability claim is not a claim that set theory uniquely determines the
program's behavior; it is a claim that no non-constructible objects are
required.

---

## 3. The anti-collapse theorem

### 3.1 Permutation symmetry and collapse

Consider a neural parameter space $\Theta=K^P$. If every parameter has the
same value—say, zero—then the network function is invariant under permutation
of any pair of units within the same layer.

**Definition 3.1** (Parameter collapse by symmetry). A parameter vector
$\theta\in\Theta$ exhibits permutation collapse if there exists a non-identity
consistent hidden-unit permutation $\pi$ such that $\pi(\theta)=\theta$.
Function equality $f_\theta=f_{\pi(\theta)}$ alone is not collapse: consistent
hidden-unit permutations are ordinary reparameterization symmetries of neural
networks even when all units are distinct.

**Theorem 3.2** (Zero initialization implies collapse). If $\theta=0^P$ and
the network contains at least one hidden layer with $d\ge 2$ units, then
neural collapse by symmetry holds.

*Proof.* With $\theta=0$, every weight matrix is the zero matrix. For any
permutation $\pi$ of hidden-unit indices, $W'_{ij}=W_{\pi(i),\pi(j)}=0=W_{ij}$.
Thus $\pi(\theta)=\theta$, and trivially $f_\theta=f_{\pi(\theta)}$. Moreover,
the gradients are identical for all units in each layer, so gradient-based
optimization preserves the symmetry.

**Corollary 3.3.** A network initialized entirely to zero cannot break
symmetry through training, because all symmetric units receive identical
gradients at every step.

### 3.2 How ZERO breaks symmetry

ZERO obtains initial storage via `calloc`, yielding zero-filled memory. It
then applies the following symmetry-breaking operations before the first
forward pass:

1. RMS normalization gains $g$ are set to 1.0 (not zero).
2. Token embeddings $E\in K^{V\times d}$ receive deterministic pseudorandom
   values from a splitmix64 generator seeded with `seed + 1`.
3. Each projection matrix $W_Q,W_K,W_V,W_O,W_1,W_2$ in each layer receives
   independent pseudorandom values.
4. Rotary position encodings distinguish positions $t\neq s$ by rotation
   angle: $\operatorname{RoPE}_t\neq\operatorname{RoPE}_s$ for $t\neq s$.
5. Different vocabulary indices select separately generated embedding rows.
   Whether any two realized rows are identical is a deterministic property of
   the frozen seed and can be checked directly.

**Proposition 3.4** (Realized asymmetry criterion). For a fixed seed, if two
hidden units have different incoming or outgoing parameter vectors, then a
permutation exchanging only those units does not leave $\theta$ fixed, so that
pair is not collapsed in the sense of Definition 3.1.

The generator is deterministic after the seed is fixed, so no probability is
attached to that realized parameter vector. A probabilistic collision analysis
would require an explicit distribution over seeds and the actual float-mapping
procedure; a scalar 64-bit PRNG collision bound is not a bound on equality of
entire floating-point rows.

### 3.3 Information cannot arise from zero alone

Let $A$ be a deterministic algorithm. For any input random variable $X$, the
output Shannon entropy satisfies

$$
H(A(X))\le H(X).
$$

This is the data processing inequality: deterministic computation cannot
increase entropy.

**Theorem 3.5** (No model from zero alone). For a fixed program binary and
configuration, $A(\text{seed},\text{corpus})$ determines the trained
parameters. Therefore

$$
H(\text{trained parameters})\le H(\text{seed},\text{corpus}).
$$

The empty set supplies zero bits of entropy. The trained model's information
content is bounded by the entropy of the corpus plus the seed. ZERO does not
create Shakespeare from ∅; it compresses regularities observed in the corpus
into a parameter vector.

**Corollary 3.6.** Distinct corpora produce distinct trained models. The empty
corpus (no training data) produces only the deterministically initialized
network, whose outputs are a fixed function of the seed.

---

## 4. The language object

### 4.1 Alphabet and control values

The deployed alphabet is the normalized ASCII character set

$$
\Sigma=\{0,1,\ldots,127\},\qquad |\Sigma|=128.
$$

Values 1–7 are normally dormant ASCII control characters and are repurposed
for channel structure:

| Value | Name | Role |
| ---: | --- | --- |
| 1 | `REC_BEG` | Channel record begins |
| 2 | `MSG_BEG` | Message begins |
| 3 | `REPLY_TO` | Reply edge; next token names the addressed role |
| 4 | `MSG_END` | Message ends |
| 5 | `REC_END` | Channel record ends |
| 6 | `TGT_BEG` | Supervised target span begins |
| 7 | `SUM_BEG` | Lossy memory summary begins |

Ordinary normalized corpus text uses newline and printable ASCII values 32–127;
values 8–31 are not printable text. Values 1–7 are reserved protocol controls,
and value 0 is not emitted as ordinary corpus text.

### 4.2 Contexts and continuations

A context is a string $x\in\Sigma^{\le 512}$. The C tokenizer preserves ASCII
case and control characters supplied by structured corpus generators,
transliterates a declared set of punctuation and diacritics, and maps remaining
unsupported Unicode input to `?`. Source-specific editorial cleanup and
whitespace normalization occur before tokenization. In the selected model there
are no learned BPE merges: one resulting byte is one token.

### 4.3 The channel record as a relational object

**Definition 4.1** (Channel record). A channel record is a tuple

$$
R=(c,m,(r_1,u_1),\ldots,(r_k,u_k),q,y)
$$

where:

- $c\in\Sigma^{\le 32}$ is the channel style ("vibe"),
- $m\in\Sigma^{\le 80}$ is the previous lossy memory,
- $r_i\in\Sigma^{\le 8}$ is a locally anonymized speaker role,
- $u_i\in\Sigma^{<\omega}$ is a message,
- $q\in\Sigma^{\le 8}$ identifies the role being answered,
- $y\in\Sigma^{<\omega}$ is ZERO's target reply or the next memory.

Speaker identity is local to the record: $r_i$ represents "the role that spoke
$i$th in this exchange," not a permanent identity. The reply edge $(q)$ is an
explicit relation—dialogue is not assumed to follow temporal adjacency.

### 4.4 Serialization

A record $R$ is serialized as a string $s(R)\in\Sigma^*$ using the control
values above. Training and inference operate on $s(R)$, not on the abstract
tuple. The serialization fits within the 512-token context window by
construction, so $|s(R)|\le 512$.

---

## 5. The transformer as a finite function

### 5.1 Architecture parameters

The deployed configuration is defined by the sextuple

$$
\mathcal A=(T=512,\;V=128,\;d=256,\;H=8,\;L=6,\;f=1056),
$$

with per-head dimension $d_h=d/H=32$.

### 5.2 Parameter count

**Theorem 5.1**. The total trainable parameter count is

$$
\begin{aligned}
P&=Vd+L(4d^2+2df+2d)+d\\
&=128\cdot 256+6(4\cdot 256^2+2\cdot 256\cdot 1056+2\cdot 256)+256\\
&=4{,}852{,}992.
\end{aligned}
$$

The terms are: token embedding $(Vd)$, four attention projections per layer
$(4d^2)$, two feed-forward projections per layer $(2df)$, two RMS gain vectors
per layer $(2d)$, and final RMS gain $(d)$. Output projection is tied to the
embedding matrix. Rotary position encoding has no learned parameters.

### 5.3 Embedding and RMS normalization

**Definition 5.2** (Token embedding). The embedding matrix is
$E\in K^{V\times d}$. For token $x_t\in\Sigma$, the initial activation is

$$
h_t^{(0)}=E_{x_t,:}\in K^d.
$$

**Definition 5.3** (RMS normalization). For $z\in K^d$ and learned gain
$g\in K^d$,

$$
\operatorname{RMSNorm}_g(z)_i=g_i\cdot\frac{z_i}
{\sqrt{d^{-1}\sum_{j=1}^d z_j^2+\varepsilon}},
\qquad\varepsilon=10^{-5}.
$$

Before the coordinate-wise learned gain, RMSNorm preserves direction under
positive uniform scaling of $z$ (up to the effect of $\varepsilon$). Negative
scaling reverses direction, and nonuniform learned gains can alter it.

### 5.4 Rotary position encoding

**Definition 5.4** (RoPE). For each adjacent coordinate pair
$(2j,2j+1)$ in head dimension $d_h$, the rotary frequency is

$$
\omega_j=10000^{-2j/d_h},\qquad j=0,1,\ldots,d_h/2-1.
$$

The rotation matrix for position $t$ and pair $j$ is

$$
R_{t,j}=
\begin{pmatrix}
\cos(t\omega_j) & -\sin(t\omega_j)\\[2pt]
\sin(t\omega_j) & \cos(t\omega_j)
\end{pmatrix}.
$$

Applied coordinate-pairwise to query and key vectors:

$$
\widetilde q_{t,h}=R_t\cdot q_{t,h},\qquad
\widetilde k_{s,h}=R_s\cdot k_{s,h}.
$$

RoPE ensures that the inner product $\langle\widetilde q_t,\widetilde k_s\rangle$
depends on the relative position $t-s$ rather than absolute positions:

**Theorem 5.5** (Relative position property). For RoPE as defined above,

$$
\langle\widetilde q_t,\widetilde k_s\rangle=
\sum_{j=0}^{d_h/2-1}\langle R_{t,j}q^{(j)},R_{s,j}k^{(j)}\rangle
=\sum_{j=0}^{d_h/2-1}\langle q^{(j)},R_{s-t,j}k^{(j)}\rangle,
$$

where $q^{(j)},k^{(j)}$ are the $j$-th coordinate pairs.

*Proof.* Rotation matrices are orthogonal and satisfy
$R_t^{\mathsf T}R_s=R_{s-t}$. The identity follows by regrouping terms.

### 5.5 Causal self-attention

In layer $\ell$, the normalized input is projected to queries, keys, and
values:

$$
\begin{aligned}
n_t^{(\ell)}&=\operatorname{RMSNorm}_{g_1^{(\ell)}}(h_t^{(\ell)}),\\
q_t&=W_Q^{(\ell)}n_t^{(\ell)}\in K^{H\times d_h},\\
k_t&=W_K^{(\ell)}n_t^{(\ell)}\in K^{H\times d_h},\\
v_t&=W_V^{(\ell)}n_t^{(\ell)}\in K^{H\times d_h}.
\end{aligned}
$$

After RoPE application, causal attention weights are

$$
\alpha_{t,s,h}=
\begin{cases}
\displaystyle\frac{\exp(\tau^{-1}\langle\widetilde q_{t,h},\widetilde k_{s,h}\rangle)}
{\sum_{j=0}^t\exp(\tau^{-1}\langle\widetilde q_{t,h},\widetilde k_{j,h}\rangle)},
& s\le t,\\[1.2em]
0, & s>t,
\end{cases}
$$

where $\tau=\sqrt{d_h}$ is the temperature scaling factor.

The head output and residual are

$$
a_{t,h}=\sum_{s=0}^t\alpha_{t,s,h}\,v_{s,h},
\qquad
r_t=h_t^{(\ell)}+D_a\cdot W_O^{(\ell)}\operatorname{concat}_h(a_{t,h}),
$$

where $D_a$ is inverted dropout: during training, $D_a=(1-p_{\text{drop}})^{-1}$
for retained units and $0$ for dropped units; at inference, $D_a=1$.

### 5.6 Feed-forward block

**Definition 5.6** (GELU activation).

$$
\operatorname{GELU}(z)=\frac{z}{2}\left[1+
\tanh\!\left(\sqrt{\frac{2}{\pi}}\,(z+0.044715\,z^3)\right)\right].
$$

The feed-forward block is

$$
\begin{aligned}
s_t&=\operatorname{RMSNorm}_{g_2^{(\ell)}}(r_t),\\
h_t^{(\ell+1)}&=r_t+D_f\cdot W_2^{(\ell)}\operatorname{GELU}(W_1^{(\ell)}s_t),
\end{aligned}
$$

with residual dropout $D_f$ applied as above.

**Proposition 5.7** (Residual distinction condition). Let a residual block be
$F(h)=h+G(h)$. For two states $h\neq h'$, their outputs remain distinct exactly
when $G(h)-G(h')\neq-(h-h')$.

*Proof.* $F(h)-F(h')=(h-h')+[G(h)-G(h')]$, which is nonzero precisely under the
stated condition.

Residual connections provide a direct identity path, but they do not
mathematically forbid exact cancellation by the learned branch. They bias the
architecture toward incremental modification rather than guarantee preservation
of every distinction.

### 5.7 Output distribution

After $L=6$ blocks:

$$
\bar h_t=\operatorname{RMSNorm}_{g_f}(h_t^{(L)}),\qquad
z_t=E\,\bar h_t\in K^V.
$$

Tying $E$ as the output projection means token $a$ and token $b$ that are
nearby in embedding space produce similar logit vectors—a form of
distributional smoothness.

The next-token distribution is

$$
p_\theta(x_{t+1}=a\mid x_{\le t})=
\frac{e^{z_{t,a}}}{\sum_{b\in\Sigma}e^{z_{t,b}}}.
$$

**Definition 5.8** (Conditional language distribution). For a continuation
$y=(y_1,\ldots,y_n)$,

$$
p_\theta(y\mid x)=\prod_{i=1}^n p_\theta(y_i\mid x,y_{<i}).
$$

For each fixed length $n$, this defines a normalized conditional distribution
over $\Sigma^n$. A probability measure over variable-length finite strings
would additionally require an explicit end-of-sequence token or termination
policy. It does not define truth, reference, intention, or consciousness.

---

## 6. Learning

### 6.1 Objective functions

**Definition 6.1** (Standard cross-entropy loss). For a sequence $x$ of length
$T$,

$$
\mathcal L(\theta;x)=-\frac{1}{T}\sum_{t=0}^{T-1}
\log p_\theta(x_{t+1}\mid x_{\le t}).
$$

**Definition 6.2** (Masked channel loss). For a channel record with target
positions $M\subseteq\{0,\ldots,T-1\}$,

$$
\mathcal L_{\text{channel}}(\theta;x,M)=
-\frac{1}{|M|}\sum_{t\in M}
\log p_\theta(x_{t+1}\mid x_{\le t}).
$$

Non-target positions (headers, previous messages, reply edges) condition the
target through causal attention but contribute no direct loss. This makes
**answer the channel** and **compress the channel** the supervised acts.

**Definition 6.3** (Weighted corpus sampling). For corpus sources
$i=1,\ldots,k$ with positive weights $w_i$, the probability of selecting
source $i$ for a training sequence is

$$
\Pr(\text{source}=i)=\frac{w_i}{\sum_{j=1}^k w_j}.
$$

This prevents the largest source from dominating. In the literary training
run, the channel file receives weight 6 while individual authors receive
weight 1, acknowledging that channel structure is the harder task.

### 6.2 The ZERO.4 multi-teacher loss

**Definition 6.4** (Channel-specific teacher mixture). For channel $c$ and
task $k$, the loss is

$$
\mathcal L_c(\theta)=h_c\cdot\mathcal L_{\text{hard}}(\theta)
+z_{1,c}\cdot\mathcal L_{\text{Z1}}(\theta)
+z_{2,c}\cdot\mathcal L_{\text{Z2}}(\theta)
+z_{3,c}\cdot\mathcal L_{\text{Z3}}(\theta),
$$

where $h_c+z_{1,c}+z_{2,c}+z_{3,c}=1$ and each teacher weight $z_{i,c}$ is
zero unless:

1. Teacher $i$ is declared eligible for channel $c$, task $k$,
2. Teacher $i$ exceeds the hard-only control on frozen validation, and
3. The weight is frozen before student training begins.

$\mathcal L_{\text{Z}i}$ is the cross-entropy between teacher $i$'s predicted
distribution and the student's predicted distribution, applied only to output
positions. This is a probability mixture, not parameter averaging or
hidden-state mixing.

**Theorem 6.5** (Unsupported mass returns to hard target). If
$\sum_{i}z_{i,c}<1-h_c$, the remaining probability mass is assigned to the
hard target. Teacher weights are never silently reassigned to another teacher.

### 6.3 Optimization

Gradients $\nabla_\theta\mathcal L$ are computed by the hand-written C
backward pass. After mini-batch averaging and global norm clipping to maximum
norm $\gamma$, AdamW updates are:

$$
\begin{aligned}
m_t&=\beta_1 m_{t-1}+(1-\beta_1)g_t,\\
v_t&=\beta_2 v_{t-1}+(1-\beta_2)g_t^2,\\
\widehat m_t&=\frac{m_t}{1-\beta_1^t},\qquad
\widehat v_t=\frac{v_t}{1-\beta_2^t},\\
\theta_t&=\theta_{t-1}-
\eta_t\left(\frac{\widehat m_t}{\sqrt{\widehat v_t}+\epsilon}
+\lambda\,\theta_{t-1}\right),
\end{aligned}
$$

with $\beta_1=0.9$, $\beta_2=0.999$, $\epsilon=10^{-8}$, decoupled weight
decay $\lambda$, linear warmup over $w$ steps, and optional cosine decay to a
minimum learning rate. The base trainer's `--best` checkpoint uses minimum
held-out validation loss with optional patience. Constraint experiments such as
Q2.2 and Q2.2-R instead perform feasibility-first selection over joint faculty
and replay gates.

### 6.4 Transactional constrained optimization

This section specifies the proposed Q2.3 optimizer. Shadow-state commit,
projection, rollback, and orchestration checkpoints are not implemented by the
current trainer or Q2.2-R scripts.

Checkpoint selection observes a trajectory after updates have already changed
the model. A lower-level guard treats each optimizer attempt as a transaction.
Let $g_F=\nabla_\theta\mathcal L_F$ be the faculty gradient, let
$g_R=\nabla_\theta\mathcal L_R$ be a gradient on a frozen replay probe, and
let $d_t$ be the complete parameter displacement proposed by the optimizer.
The first-order replay-loss change is

$$
\widehat{\Delta\mathcal L_R}=g_R^{\mathsf T}d_t.
$$

This quantity can be decomposed exactly over declared parameter groups $G$:

$$
g_R^{\mathsf T}d_t
=\sum_{G} (g_R)_G^{\mathsf T}(d_t)_G.
$$

The decomposition diagnoses whether embeddings, attention projections,
feed-forward matrices, or normalization gains account for predicted drift.
Individual scalar weights are not treated as independent semantic objects:
equivalent network functions may redistribute values through permutation,
rotation, or scaling symmetries.

For an allowed local replay budget $b_t$, a displacement whose predicted
change exceeds the budget can be projected onto the corresponding half-space:

$$
d_t'=d_t-
\frac{g_R^{\mathsf T}d_t-b_t}{\lVert g_R\rVert_2^2}g_R,
\qquad\text{when }g_R^{\mathsf T}d_t>b_t.
$$

**Proposition 6.6** (First-order projection). If $\lVert g_R\rVert_2>0$ and
$g_R^{\mathsf T}d_t>b_t$, then $g_R^{\mathsf T}d_t'=b_t$.

*Proof.* Substitute the definition of $d_t'$ and use
$g_R^{\mathsf T}g_R=\lVert g_R\rVert_2^2$.

The guarantee is local and first-order. Curvature, AdamW preconditioning, and
finite learning rates can make the realized loss change differ from the dot
product, so a shadow-state functional evaluation must still accept or reject
the proposed update.

Define the learned training state as

$$
X_t=(\theta_t,m_t,v_t,n_t),
$$

containing weights, AdamW moments, and committed-update count. An optimizer
attempt constructs a shadow state $\widetilde X_{t+1}$. If the declared guard
accepts it, $X_{t+1}=\widetilde X_{t+1}$; otherwise $X_{t+1}=X_t$. Weights and
moments commit or roll back together. Attempt count, sampler position, and RNG
state belong to a separate orchestration state and may advance after rejection,
so a rejected batch is not retried forever. A checkpoint records both states
for deterministic resume.

The hard 2% replay promotion limit remains a trajectory-level constraint. A
per-attempt guard uses a nonzero local budget or guard band; requiring replay
loss to decrease after every update would be stronger than the promotion
contract and could prevent useful movement through parameter space.

---

## 7. Channel dynamics

### 7.1 The channel as a dynamical system

An ordinary transformer treats conversation as a growing text buffer that
eventually exceeds the context window. ZERO instead treats a channel as a
controlled discrete-time dynamical system with bounded state.

**Definition 7.1** (Channel state and transition). A channel is a tuple

$$
\mathcal C=(\theta,c,m_t,E_t,u_t)
$$

where:
- $\theta$ are the frozen model parameters,
- $c$ is the stable channel style,
- $m_t\in\Sigma^{\le 80}$ is the lossy memory at time $t$,
- $E_t$ is the episodic store (a finite map from hypervectors to memories),
- $u_t\in\Sigma^{<\omega}$ is the next human message.

The channel transition function $\Phi$ produces a reply and a new memory:

$$
\Phi(\mathcal C)=(z_t,m_{t+1},E_{t+1}),
$$

where

$$
\begin{aligned}
z_t&\sim p_\theta(\cdot\mid c,m_t,\operatorname{recall}(E_t,u_t),u_t),\\
m_{t+1}&\sim p_\theta(\cdot\mid c,m_t,\operatorname{recall}(E_t,u_t),u_t,z_t,\texttt{SUM\_BEG}),\\
E_{t+1}&=\operatorname{store}(E_t,\phi(u_t,z_t),m_{t+1}).
\end{aligned}
$$

The functions $\operatorname{recall}$ and $\operatorname{store}$ are
non-neural (see §8). After the transition, the pair $(u_t,z_t)$ is discarded
from working memory.

**Theorem 7.2** (Bounded online state). With context length $T=512$, memory
length at most $80$, and episodic capacity $32$, the conversational state
$|c|+|m_t|+|E_t|+|u_t|$ is bounded by a constant independent of the number of
completed exchanges.

*Proof.* $c$ is fixed-length. $m_t$ is truncated to 80 characters. $E_t$
contains at most 32 entries, each of bounded size (256-dimensional vector +
80-character memory). $u_t$ plus the serialized $c,m_t,e_t$ must fit within
the 512-token context. All quantities are bounded.

### 7.2 Two timescales

The channel creates two distinct timescales:

1. **Working time** ($t$-indexed): exact tokens within the current context
   window. The transformer attends over this timescale with full precision.
2. **Channel time** ($\tau$-indexed): compressed memory $m_\tau$ passed from
   exchange to exchange. Information crosses this timescale only through the
   learned summary $m_{\tau+1}$.

The compression $m_{\tau+1}$ is intentionally lossy. It is not required to
permit reconstruction of $(m_\tau,u_\tau,z_\tau)$. The model learns what to
preserve and what to discard.

### 7.3 Information-theoretic analysis of the memory bottleneck

**Theorem 7.3** (Memory compression bound). The lossy memory $m_{t+1}$ can
preserve at most $80\cdot\log_2 128=560$ bits of information about the
previous exchange, compared with the full exchange which may contain thousands
of bits.

*Proof.* $m_{t+1}\in\Sigma^{\le 80}$. At 7 bits per character (128-token
vocabulary), the maximum information content is $80\cdot 7=560$ bits. The full
exchange $(m_t,u_t,z_t)$ can be up to $512\cdot 7=3{,}584$ bits.

The bottleneck ratio is approximately $560/3584\approx 0.156$: at most 15.6%
of the exchange information can survive into the next turn via the memory
mechanism. The model must learn to allocate these bits to distinctions that
matter for future replies.

---

## 8. Holographic episodic recall

### 8.1 The encoding function

**Definition 8.1** (Deterministic hypervector encoder). The encoder
$\phi:\Sigma^{<\omega}\to\mathbb R^{256}$ maps a text to a unit vector through
the following procedure:

1. Lowercase the text.
2. Extract features: non-stopword lexical tokens, character prefixes of
   length 3–5, and adjacent feature pairs.
3. Compute deterministic 64-bit hashes for whole words, selected prefixes, and
   adjacent-word pairs.
4. Expand each whole-word, prefix, or pair feature into respectively 16, 6, or
   8 signed coordinates with weights 1.0, 0.45, or 0.65.
5. Accumulate the resulting sparse signed features.
6. Normalize: $\phi(x)=\text{raw}/\|\text{raw}\|_2$ if $\|\text{raw}\|_2>0$,
   else $\mathbf 0$.

This literary-recall encoder is parameter-free and shared by native and WASM
`literary_infer`. The faculty controller has a separate deterministic encoder
over structured channel-state fields; the two must not be treated as one
coordinate system without an explicit alignment step.

**Heuristic 8.2** (Approximate orthogonality). Under a random-hash model, texts
sharing few features are expected to have cosine near zero. The deployed hash
is deterministic, so this is an empirical retrieval property, not a theorem
about every pair of texts.

**Heuristic 8.3** (Approximate similarity preservation). Shared hashed features
often raise cosine similarity, but collisions, normalization, prefix features,
and pair features prevent a general monotonicity guarantee.

### 8.2 The episodic store

**Definition 8.4** (Browser episodic store). The C runtime stores a ring buffer
of at most $K=32$ vectors $\phi(k_i)$ and returns slot indices and scores. The
browser JavaScript keeps the corresponding compressed-memory strings $m_i$.
Together they behave as pairs $(\phi(k_i),m_i)$.

**Definition 8.5** (Browser recall policy). Given query $q$, the C runtime
returns the best slot $i^*$ and its cosine score. The browser returns

$$
e_t=
\begin{cases}
m_{i^*}, & \text{if }\max_i\langle\phi(q),\phi(k_i)\rangle\ge\eta,\\
\varnothing, & \text{otherwise},
\end{cases}
$$

where $i^*=\arg\max_i\langle\phi(q),\phi(k_i)\rangle$ and $\eta=0.22$ is the
abstention threshold.

**Definition 8.6** (Store). After each exchange, the new entry
$(\phi(u_t,z_t),m_{t+1})$ is inserted at the write position, overwriting the
oldest entry if the buffer is full.

**Proposition 8.7** (Caller abstention). If the best score is below $\eta$, the
browser discards the slot and sets $e_t=\varnothing$. `lm_holo_recall` itself
does not apply this threshold.

### 8.3 Three-part memory architecture

The three memory systems operate at different levels:

| System | Type | Capacity | What it preserves |
|---|---|---|---|
| Working context | Exact, neural | 512 tokens | Verbatim recent tokens |
| Recurrent memory | Learned, lossy, neural | 80 characters | Compressed channel history |
| Episodic recall | Exact, non-neural | 32 entries | Old compressed moments |

Their combination is not redundant: each addresses a failure mode of the
others. Working context is lossless but ephemeral. Recurrent memory persists
but is lossy. Episodic recall retrieves old compressed states but abstains
when no pattern matches.

---

## 9. Quantization and deployment

### 9.1 Row-wise int8 quantization

**Definition 9.1** (Quantization function). For a matrix row
$w_r\in\mathbb R^{d}$,

$$
s_r=\begin{cases}
\frac{\max_j|w_{rj}|}{127}, & \max_j|w_{rj}|>0,\\
1, & \text{otherwise},
\end{cases}\qquad
q_{rj}=\operatorname{clip}_{[-127,127]}\left(
\operatorname{round}\!\left(\frac{w_{rj}}{s_r}\right)\right).
$$

**Definition 9.2** (Dequantized inference). During inference, each
multiplication uses the approximation $\widehat w_{rj}=s_r\cdot q_{rj}$. The
inner product becomes

$$
\langle\widehat w_r,x\rangle=
s_r\sum_{j=1}^d q_{rj}x_j.
$$

**Theorem 9.1** (Error bound). For a single weight, the quantization error
satisfies

$$
|w_{rj}-\widehat w_{rj}|\le s_r/2\le\frac{\max_k|w_{rk}|}{254}.
$$

*Proof.* Rounding error is at most 0.5 quanta. One quantum is $s_r$, so
$|w_{rj}-\widehat w_{rj}|\le s_r/2$. Substituting the definition of $s_r$
gives the bound.

Matrix and embedding rows use this int8 representation with floating-point row
scales. Normalization-gain vectors remain float32, so the browser artifact is a
mixed-format export rather than an all-int8 parameter file.

### 9.2 Sampling policy

The learned distribution $p_{\widehat\theta}$ may be modified during
generation:

- **Temperature** $\tau>0$: $p_\tau(a)\propto p_{\widehat\theta}(a)^{1/\tau}$.
  $\tau<1$ sharpens, $\tau>1$ flattens.
- **Top-$k$**: restrict to the $k$ most probable tokens, renormalize.
- **Repetition penalty** $\rho>1$: subtract $\log\rho$ from a token's log score
  if it occurs in the recent 64-token ring, before top-$k$ sampling.

These operations alter the generation policy, not the learned distribution
$p_{\widehat\theta}$ itself.

---

## 10. The atomic channel protocol

### 10.1 State machine

The faculty controller defines a deterministic finite-state machine over
states $\{\text{IDLE},\text{EMITTING},\text{CLOSED}\}$:

```
IDLE ──ENTER(faculty,task)──► EMITTING ──EMIT(artifact,summary,request)──► EMITTING
                                    │
                                    └──CLOSE──► CLOSED ──VERIFY(valid)──► IDLE (commit)
                                                         ├─VERIFY(invalid)──► IDLE (reject)
```

**Theorem 10.1** (Safety properties). For the controller defined in
`faculty_protocol.h`:

1. **Switch lock**: transitions from EMITTING or CLOSED to a different
   faculty are rejected. Only IDLE admits `ENTER`.
2. **Atomic commit**: artifact and summary commit together after successful
   external verification. Rejection leaves shared state unchanged.
3. **Channel isolation**: a channel can only modify its own summary and
   artifact. No channel can mutate another channel's state.
4. **Bounded channels**: at most 16 concurrent channels.

*Proof.* Direct inspection of the C implementation. The state machine enforces
(1) by requiring `state==IDLE` in `faculty_enter`. It enforces (2) by
requiring `verified==1` before copying proposed state to channel state in
`faculty_resolve`. It enforces (3) by indexing channels by `active_channel`
and never writing to other indices. It enforces (4) by the constant
`FACULTY_MAX_CHANNELS=16`.

### 10.2 Registrar encoding

**Definition 10.2** (Registrar). The registrar encodes a committed chunk into
the common 256-dimensional Holo space:

$$
z_{\text{chunk}}=\phi_F(\text{channel\_id}\;\|\;\text{summary}\;\|\;
\text{artifact}\;\|\;\text{authority}\;\|\;\text{verdict}),
$$

where $\|$ denotes ordered field inclusion and $\phi_F$ is the faculty
controller's deterministic character-hash encoder. It is distinct from the
literary word/prefix/pair encoder in §8.1.

**Theorem 10.3** (Registrar properties).

1. **Determinism**: same inputs → same vector.
2. **Parameter-free**: no learned weights.
3. **Source-labelled input**: channel id and authority participate in the hash;
   finite-dimensional hash collisions are still possible.
4. **Verdict-labelled input**: an explicit verdict participates in the hash.
   The current rejection path preserves the old committed state and does not
   store or encode a rejected proposal.

The registrar thus provides a stable, inspectable coordinate system for
cross-channel indexing without requiring aligned teacher latent spaces.

---

## 11. Formal propositions

### Proposition 1: Finite representability

> For any fixed configuration $\mathcal A$, corpus $D$, seed $s$, update count
> $N$, and finite memory capacity, every defined state of ZERO can be encoded
> as an element of $V_\omega$.

*Proof.* Each component—weights, activations, optimizer moments, RNG state,
channel summaries, episodic store entries—is a finite-dimensional array of
finite-precision values. Finite arrays of finite values are hereditarily
finite (Theorem 2.12). The state at any update $n\le N$ is a finite tuple of
such components. Finite tuples of hereditarily finite sets are hereditarily
finite.

### Proposition 2: Bounded online state

> The current literary browser runtime's non-model conversational state is
> bounded by a constant independent of the number of completed exchanges.

*Proof.* Working context, displayed recurrent memory, and the 32-slot Holo ring
all have fixed limits; old entries are discarded or overwritten. The separate
faculty controller also has fixed 16-channel × 192-character summary storage,
but it is not integrated into the current browser. Each runtime is bounded by
its own declared constants. (See Theorem 7.2.)

### Proposition 3: No model from zero alone

> The empty set alone does not determine the trained parameter vector.

*Proof.* Let $\Theta$ be the space of parameter vectors for the fixed
architecture. For a fixed program, let $f(s,D)$ be the trained parameters
after observing corpus $D$ with seed $s$. There exist corpora $D_1\neq D_2$
such that $f(s,D_1)\neq f(s,D_2)$ (e.g., Shakespeare vs. Blake). The empty set
∅ provides no information that discriminates between $D_1$ and $D_2$.
Therefore $f(s,D)$ is not a function of ∅ alone. (See Theorem 3.5.)

### Proposition 4: Shared foundation does not force collapse

> Two representations constructed over the same empty foundation may remain
> distinct whenever their membership, index, token, position, or learned
> relations differ.

*Proof.* By the Axiom of Extensionality, two sets are identical iff they have
the same members. Two distinct finite ordinals $n\neq m$ have different
members ($n\in m$ or $m\in n$ but not both) despite sharing ∅ in their
transitive closure. In the network, different indices select different
initialized weights (Theorem 3.4) and receive different gradient updates from
different corpus positions. The transitive closure of every weight tensor
includes ∅; this shared ground does not erase the distinctions introduced by
initialization and training.

### Proposition 5: Collapse bound

> If a language model with parameter vector $\theta$ achieves zero loss on a
> training set containing at least two distinct tokens, then $\theta$ cannot
> assign identical probability to all tokens.

*Proof.* Zero loss requires $p_\theta(x_{t+1}\mid x_{\le t})=1$ for the
observed token and $0$ for all others. If two distinct tokens $a\neq b$ each
appear as a target in the training set, then at their respective positions,
$p_\theta(a)=1$ and $p_\theta(b)=1$ under different contexts. The softmax
cannot assign probability 1 to both $a$ and $b$ under the same context,
confirming that a zero-loss solution is not uniformly distributed on those
observed contexts. Merely having finite, nonzero training loss does not prove
that a model has left a uniform-output state.

---

## 12. Compositional verification

### 12.1 The decomposition thesis

The implemented quantity path routes one declared operation to one deterministic
kernel. Extending that boundary to other faculties is a design thesis:

> Every domain that matters has verifiable substructure. A neural model
> should route to verifiers at the finest available granularity, then
> compose their outputs into a response. It should never compute what a
> deterministic program can compute exactly.

"Model routes, kernel computes" does not describe a limitation. It
describes the correct division of labor for any intelligence, biological
or artificial. Humans do not multiply large numbers internally; we execute
algorithms or use tools. We do not check proofs by statistical intuition;
we apply decision procedures. We do not verify citations by recall; we
consult sources. Routing is intelligence. Computation is external to it.

### 12.2 Verifier granularity

| Granularity | Example | Routing signature | Kernel |
|---|---|---|---|
| Coarse (faculty) | "this is a geometry problem" | `@enter geometry` | `geometry_check` |
| Medium (operation) | "construct a perpendicular bisector" | `geometry.construct` | Construction parser + solver |
| Fine (sub-claim) | "point M is the midpoint of AB" | Model-generated check request | Midpoint verifier |
| Atomic (fact) | "distance AM = distance MB" | Numeric equality assertion | Exact rational comparison |

The same transformer routes at every granularity. The kernel verifies at
every granularity. Only the routing signature changes.

### 12.3 Composition

A domain without an atomic kernel (literary quality, emotional
authenticity, humor) is not a domain where the model "computes
internally." It is a domain where the kernels are finer-grained than
currently built, and the **composition function** — the weighted
combination of sub-verifier outputs — is learned rather than mechanical.

**Definition 12.1** (Composition function). Let $\mathcal V=\{v_1,\ldots,v_K\}$
be a set of verifiers, each producing an output $v_i(x)\in[0,1]$ for
input $x$. A composition function $C:[0,1]^K\to[0,1]$ produces an
aggregate judgment. $C$ may be:

1. **Mechanical**: $C(v_1,\ldots,v_K)=\sum_i w_i v_i$ for fixed weights $w_i$.
2. **Learned**: $C$ is parameterized by a subset of the model's weights
   and trained against human judgments.
3. **Context-dependent**: $C$ depends on the task, channel, and prior
   summaries — the weights $w_i(x)$ are themselves model outputs.

The model's claim "this pastiche is competent but derivative" is not a
single verifier output. It is the composition of sub-verifications
(diction 0.87, meter 0.92, allusion 0.45) through a learned composition
function.

### 12.4 Emergent verification

**Definition 12.2** (Verifier proposal). A model may propose a new
verifier $v_{\text{new}}$ when it detects a pattern not captured by
existing verifiers. The proposal must specify:

1. The pattern to be detected (operational definition).
2. The verification method (how to check it).
3. The expected correlation with human judgments.

The proposal is evaluated externally (human or automated). If accepted,
$v_{\text{new}}$ joins the verifier library. The model learns to route to
it and compose with it.

This makes the verification surface **extensible by the model itself** —
a form of learned abstraction that, unlike internal neural
representations, is inspectable, falsifiable, and attributable.

### 12.5 Capacity bounds for compositional routing

**Proposition 12.3** (Request-string cardinality bound). A fixed-length request
can syntactically distinguish at most
$V^{L}=128^{L}$ distinct verifiers through a request of length $L$
tokens. For $L=2$ (the current faculty.operation grammar),
$N_{\text{ops}}\le 16{,}384$. The actual grammar admits fewer valid names, and
this cardinality bound says nothing about learned routing accuracy.

**Observation 12.4** (No hard attended-position count). Softmax attention may
assign nonzero weight to all positions in the 512-token context. Head dimension
constrains the query/key representation and score-matrix structure, not the
number of positions with nonzero or "non-negligible" weight. A usable bound on
the number of faculty summaries must therefore be measured, not inferred as
$H\cdot d_h$.

**Observation 12.5** (Feed-forward width is not a faculty count). The FFN at
each layer has shape $(d\to f\to d)=(256\to1056\to256)$, but hidden width does
not imply 1,056 independent semantic features or a numeric faculty capacity.
Parameter count, data coverage, routing ambiguity, context, optimization, and
gradient competition can all become practical limits and require ablation.

**Conjecture 12.6** (Interference phase transition). As the number of
faculties $F$ increases, routing accuracy undergoes a phase transition:
near 100% until a critical $F^*$, then rapid degradation. The critical
value $F^*$ depends on:

1. **Representational overlap**: how similar the textual signatures of
   different faculties are in embedding space.
2. **Gradient competition**: how many faculties produce conflicting
   gradient updates for the same parameters.
3. **Replay pressure**: how much new-faculty training displaces
   historical capabilities.

The measurement protocol for determining $F^*$ is defined in
`SATURATION.md`.

---

## 13. Non-claims

ZERO explicitly does **not** claim:

1. **Set-theoretic necessity.** ZFC describes a possible foundation, not the
   only one. The C program is not a theorem prover for ZFC.

2. **Exact arithmetic.** IEEE 754 binary32 is not $\mathbb R$. Rounding
   errors accumulate through 6 layers × 2 residuals × softmax. The
   mathematical specification uses $\mathbb R$; the implementation does not.

3. **Next-token likelihood as truth.** $p_\theta(y\mid x)$ measures
   statistical regularity in the training corpus. It does not measure
   veridicality, logical validity, or factual accuracy.

4. **Lossy summary as faithful transcript.** $m_{t+1}$ is shorter than the
   exchange it compresses. Information is lost. The model is not required to
   reconstruct the past from the summary.

5. **Cosine similarity as semantic identity.** $\langle\phi(x),\phi(y)\rangle$
   measures feature overlap under a deterministic hash. It is a retrieval
   heuristic, not a theory of meaning.

6. **Finite corpus as general intelligence.** The model is trained on
   Shakespeare, Blake, Crowley, the KJV Bible, synthetic logic proofs, and
   consented channel data. It is a specialist of its training distribution.

7. **Empty set as consciousness.** Grounding in ∅ is a mathematical
   construction technique, not a theory of mind, experience, or qualia.

8. **Fluency as proof validity.** The literary checkpoint may produce
   plausible-looking logical statements. Only `logic_corpus --verify` decides
   formal validity. The model is not thereby a theorem prover.

---

## 14. The construction in one diagram

```
∅  (Axiom of Empty Set)
│
├─► 0,1,2,...  (von Neumann ordinals, Axiom of Infinity)
│   │
│   ├─► Σ = 128  (finite alphabet as ordinal)
│   ├─► T = 512  (context length as ordinal)
│   ├─► d = 256  (embedding dimension as ordinal)
│   │
│   └─► Finite sequences, vectors, matrices
│       (Kuratowski pairs, Cartesian products, functions)
│
├─► C program  (operators: forward, backward, AdamW, RoPE)
│   │
│   ├─► calloc → zero-filled storage
│   ├─► splitmix64(seed+1) → symmetry-breaking initialization
│   ├─► corpus observations → gradient updates
│   │
│   └─► θ ∈ K^4852992 → trained parameter vector
│       (a finite function from parameter indices to binary32 values)
│
├─► Channel system  (dynamical system, bounded state)
│   │
│   ├─► (c, m_t, E_t, u_t) ─► (z_t, m_{t+1}, E_{t+1})
│   ├─► Working memory ⊕ Lossy recurrence ⊕ Episodic recall
│   │
│   └─► Faculty controller: IDLE ⇄ EMITTING → CLOSED → COMMIT
│
└─► Quantized deployment  (int8 row-wise, browser WASM)
    │
    └─► p_θ̂(y|x) → sampled tokens → channel reply
```

Each arrow is a construction or computation. Each node is a finite object
whose transitive closure contains ∅. The distinctions — which token comes
next, which memory survives, which channel speaks — are introduced by the
asymmetric relations built upon that common ground. The empty set is the
foundation, not the conclusion.

---

## Appendix A: Notation index

| Symbol | Meaning |
|---|---|
| $\varnothing$ | Empty set |
| $S(n)$ | von Neumann successor $n\cup\{n\}$ |
| $V_\omega$ | Hereditarily finite sets |
| $\Sigma$ | Alphabet $\{0,\ldots,127\}$ |
| $\Sigma^{<\omega}$ | All finite strings over $\Sigma$ |
| $\Sigma^{\le n}$ | Strings of length at most $n$ |
| $K$ | Numerical field ($\mathbb R$ in spec, binary32 in impl) |
| $T$ | Context length (512) |
| $V$ | Vocabulary size (128) |
| $d$ | Embedding dimension (256) |
| $H$ | Attention heads (8) |
| $d_h$ | Per-head dimension (32) |
| $L$ | Transformer layers (6) |
| $f$ | Feed-forward dimension (1056) |
| $P$ | Total parameters (4,852,992) |
| $\theta$ | Parameter vector |
| $p_\theta$ | Model distribution |
| $\widehat\theta$ | Quantized parameters |
| $\phi$ | Hypervector encoder |
| $\Phi$ | Channel transition function |
| $\mathcal C$ | Channel state |
| $m_t$ | Lossy memory at time $t$ |
| $E_t$ | Episodic store at time $t$ |
| $z_t$ | ZERO reply at time $t$ |
| $c$ | Channel style / vibe |

## Appendix B: References

The implementation and its mathematical specification draw on:

1. Zermelo-Fraenkel set theory with Choice (ZFC) for the foundational ladder.
2. Vaswani et al. (2017) for the transformer architecture.
3. Su et al. (2021) for rotary position embeddings (RoPE).
4. Zhang and Sennrich (2019) for RMS layer normalization.
5. Loshchilov and Hutter (2019) for decoupled AdamW.
6. Hendrycks and Gimpel (2016) for the GELU activation.
7. Plate (2003) for holographic reduced representations, adapted here as the
   deterministic hypervector encoder and episodic recall mechanism.
8. The IEEE 754-2008 standard for binary32 floating-point arithmetic.

All are implemented from scratch in C11 with no external tensor, autograd, or
machine learning libraries.
