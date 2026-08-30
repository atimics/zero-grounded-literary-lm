# Q22 Zero to Solomon shared task surface

Q22 now publishes a family-neutral training file alongside the existing Zero
token stream. `quantity-request.train.jsonl` contains only the 9,500 training
records. The frozen evaluation surface remains the 500-row disjoint promotion
set. This separation prevents the evaluation answers from entering a shared
family's training input.

Generate and check the exact bytes with:

```bash
make zero4-q22-shared-task-check
```

The immutable file names, hashes, generation settings, and source entry points
are recorded in
`benchmarks/zero4-q22-shared-task-v1/manifest.json`. Zero keeps its existing
`zero.quantity-operation-request.v1` channel encoding and
`quantity_request_eval.c` verifier. Solomon must encode the same JSONL and
score the same promotion TSV; it may not replace either common file.

This change publishes the bridge surface. It does not run a Solomon training
experiment and does not create a cross-family scientific result.
