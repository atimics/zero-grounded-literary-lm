# Reasoner 5.5 task guide development design

This development experiment follows the source-choice diagnostics. It compares
learning with search that groups programs by exact behavior.

## Fixed inputs

Use the original R5.5 source and development families, operations, demonstration,
tie salts, 125-input verifier, 64-proposal limit, 4,096-check cap, and 31 role
derangements. There are 64 source tasks per generator and eight target tasks.
Each target keeps its two source views and two tie repeats together.

Every method reconstructs the eight operations with 32 queries. Ranking uses
those public reconstructions and the one demonstration. The full target map
supplies source-training labels and verifier answers.

## Search

Enumerate all 4,096 programs. Group programs with the same full affine map.
Use the smallest syntax index as the group's representative. Rank groups that
match the demonstration first. Break score ties with the original mix64
function applied to the episode salt XOR the semantic key times its original
mix constant. Break any remaining tie by semantic key.

Inject a wrong candidate, then offer up to 64 ranked groups. Reuse the original
canonical fallback over the full program universe. Count 4,096 program
expansions, one group expansion per distinct map, and every offered candidate.
Exact verification remains the acceptance rule.

## Four features and fixed training

Each feature is rounded to an integer in millionths. Features are:

1. Log group size divided by log 4,096.
2. Fraction of member programs that use four distinct roles.
3. Log of one plus the mean source-guide score, divided by seven times log 65.
4. Fraction of lane values matching the demonstration's output after each of
   the first three program steps, averaged over member programs.

The source guide uses the original canonical source solutions. Its role counts
are fixed before fitting the four weights. For each source task, train a
softmax over groups that match the demonstration. The exact target group is
the label. Average the loss equally over the 64 source tasks.

Fit one model per source generator. Start at `[log(4096), 0, 0, 0]`. Use 256
full-batch gradient steps, learning rate 0.5, and an L2 penalty of 0.01 on the
change from the starting weights. Round the final weights to signed integer
millionths. Rank with an integer dot product. This configuration is fixed
before measuring the new methods on the development targets.

## Controls and evidence

Compare equal group scores, group-size scores, summed source scores, the fitted
task guide, complete source removal, lexical role mapping, oracle role mapping,
removal of the source-score feature, and all 31 fixed role shuffles.

Complete source removal runs the same path as group-size scoring. Oracle and
recovered role mappings must give the same task-guide search. Preserve exact
answers, wrong-answer rejection, candidate coverage, and fallback behavior.
Independently replay source training, features, ranks, and verifier outcomes.

Report all methods and all eight target-level comparisons. Keep the original
R5.5 development decision as its own record. Measure adapter recovery,
enumeration, grouping, scoring, sorting, and verification separately. Record
source preparation and model size alongside full search time.

These public targets serve development. A scientific claim will require a
separate frozen evaluation design and fresh families.
