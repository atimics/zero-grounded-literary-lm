# Experiment evidence budgets

Compute is only one cost of an experiment. A prospective experiment also
spends attention on literature discovery, critical reading, design,
implementation, evaluation, interpretation, and the roadmap choices that the
result changes. Those costs and the value of the decision being purchased must
be visible before execution is authorized.

This policy applies prospectively to new experiments and to live experiments
that have not yet produced a scientific result. Completed historical records
remain immutable.

## Required evidence file

Every prospective or live experiment must have an `EVIDENCE.json` next to its
contract. The file uses `zero.experiment_evidence.v1` and must contain:

1. **Literature map**
   - a reproducible search protocol and search date;
   - a list of stable primary sources;
   - the relevance, limitations, and design consequence of each source;
   - review state (`abstract_screened` or `full_text_reviewed`);
   - at least one source that limits or challenges the proposed rationale;
   - explicit coverage gaps.
2. **Evidence-cost ledger**
   - literature discovery and review;
   - experimental design and preregistration;
   - implementation and verification;
   - scientific execution;
   - external evaluation;
   - analysis and reporting.
3. **Decision-value statement**
   - the decision the experiment buys;
   - the action under go, no-go, and inconclusive outcomes;
   - claims the experiment cannot support;
   - downstream spending or roadmap branches affected.
4. **Cheaper alternatives**
   - literature-only resolution;
   - analysis of existing evidence;
   - a smaller diagnostic, where applicable;
   - doing nothing.
5. **Authorization gate**
   - literature review complete;
   - total incremental cost projection complete;
   - decision-value review complete;
   - explicit human approval observed.

An empty literature list is not authorization-ready. An exhaustive search that
finds no directly applicable work must still list the adjacent literature,
search protocol, and gap; absence of prior work is evidence to record, not a
reason to omit the review.

## Cost accounting

Every cost is a range rather than false precision. Record cash, agent credits,
human hours, and machine time separately. A USD-equivalent estimate may be
used to compare paths, but it must name its conversion basis and must not be
presented as an invoice when subscription credits may cover the work.

The experiment contract's compute ceiling remains a hard operational limit.
The evidence budget adds a wider economic view:

```text
knowledge + design + implementation + execution + evaluation + interpretation
```

Sunk costs remain visible but do not expand incremental authorization. Unknown
costs must be named and cannot silently count as zero.

## Value accounting

The purpose is not to manufacture a speculative ROI number. The evidence file
must make the decision legible:

- What uncertainty will be reduced?
- What will change after each possible result?
- What future work can be avoided, unlocked, or redirected?
- Is the experiment cheaper and more informative than another evidence path?
- Is a null result still useful?

If the result cannot change a decision, the experiment has not justified its
cost.

## Lifecycle

```text
draft
  -> review_incomplete
  -> ready_for_authorization
  -> authorized under a separate immutable execution budget
  -> result and actual-cost reconciliation
```

`scripts/check_experiment_evidence.mjs` validates the structure. Live execution
checkers must call it with `--require-ready`, or enforce the equivalent
condition, before an authorization can open compute.
