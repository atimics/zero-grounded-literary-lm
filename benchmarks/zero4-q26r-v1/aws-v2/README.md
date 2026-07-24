# Q2.6-R bounded AWS replacement

Status: **preregistered; launch approval pending**, 2026-07-24.

This directory contains the replacement execution envelope for Q2.6-R. It
exists because the first bounded AWS route lost its ephemeral EC2 identity
records before frozen collection. The scientific contract is unchanged.

The exact replacement rationale, observed-outcome disclosure, budget, and
provenance rules are in [`PREREGISTRATION.md`](PREREGISTRATION.md). The
machine-checked authorization is [`budget.json`](budget.json).

The package is intentionally inert:

- `manual_approval_observed` is `false`;
- `authorized_for_execution` is `false`;
- the launch workflow invokes the budget checker with
  `--require-authorized`;
- no merge of this package starts compute.

After a separate authorization change, the short-lived launch workflow starts
two independently capped AWS instances. Long computation remains on AWS. The
collector is also short-lived, never waits, and never launches or restarts
compute.

Run the local registration checks with:

```sh
make zero4-q26r-aws-v2-check
```
