# Reasoner 5.7 active-evidence development

This folder records the frozen development contract for Reasoner 5.7. The
native core and analytic controls are available for review. Development result
generation is gated on corrected Reasoner 5.6 channel-readiness evidence.

The corrected R5.6 assessment now records:

- 99 independent calibration program families;
- 99 of 99 worst-draw family coverage;
- a one-sided 95 percent Wilson lower bound of 0.9733982695;
- passing development interface, template proxy, severity proxy, and taint
  checks.

The prospective sealed-interface and static-metadata proxy audit is the open
prerequisite.

The current draft contains no R5.7 fixture or scientific result. The `execute`
command remains closed.

See [SPEC.md](SPEC.md) for the exact control equations and
[../../docs/REASONER57.md](../../docs/REASONER57.md) for the implementation
boundary.
