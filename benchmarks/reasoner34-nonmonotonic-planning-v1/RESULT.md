# Reasoner (3,3,2) cloud result

The sealed non-monotonic planning gate **passed**.

- Run: `reasoner34-planning-20260830-83bd059`
- Instance: `i-0c6c99bbd18fc407f` (terminated)
- Source commit: `83bd05962e3263cad590103eb108ac0dfd12100d`
- Source SHA-256: `43c245f2cd48823a33c875c00bc03dff81ca2cc148a80d5289b795f5c903e9c9`
- Contract SHA-256: `fb87827b2e9d6e0304be9d78f23c2682e4e798c6ae39d7ea0077d941f71da669`
- Result SHA-256: `b47970d2339d4d2921156fad8d9eea3e25d7357305f7149aa5fc6e9b0258eed2`
- Runtime: 111 instance-seconds
- Estimated EC2 cost: $0.000320666667

The semantic policy produced exact minimum plans for all 5,880 sealed worlds
with five through seven gates. All 166,680 relabeled actions were exact. Every
world required a non-monotonic detour. Greedy-distance, tool-only, hash, and
lookup controls solved zero worlds.

Decision: retain this arm as positive evidence for learned state-dependent
planning that can move away from the local goal before returning to it.
