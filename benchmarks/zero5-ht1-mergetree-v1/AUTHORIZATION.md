# HT1 pilot authorization

The seed-0 MergeTree pilot now has a separate paid-compute approval record.
The frozen preregistration, implementation record, and preflight evidence stay
unchanged.

The approval covers one training trajectory and its frozen validation on AWS.
It allows up to five resumable `c6i.4xlarge` slots. Each slot is capped at 9,000
seconds and $1.70. The operating cap is $8.50, leaving $1.50 inside the user's
$10 limit.

The next code change is a hash-bound AWS launcher. It must use immutable attempt
locks, automatic termination, state sync, and continuation-only retries. It must
also verify the frozen C2 start checkpoint, C5.1 pack stream, tokenizer,
validation packs, C5.1 control result, and C5.1 selected control checkpoint.

The source bundle and private artifact bundle need an exact upload approval
before staging. Publication, replication, promotion, and sealed-test access keep
their separate approval boundaries.
