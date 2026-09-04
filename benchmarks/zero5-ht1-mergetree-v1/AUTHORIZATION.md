# HT1 pilot authorization

The seed-0 MergeTree pilot now has a separate paid-compute approval record.
The frozen preregistration, implementation record, and preflight evidence stay
unchanged.

The approval covers one training trajectory and its frozen validation on AWS.
It allows up to five resumable `c6i.4xlarge` slots. Each slot is capped at 9,000
seconds and $1.70. The operating cap is $8.50, leaving $1.50 inside the user's
$10 limit.

The hash-bound AWS launcher uses immutable attempt locks, automatic termination,
30-second state sync, and continuation-only retries. It splits the run into
training, task scoring, candidate depth scoring, control depth scoring, and
result assembly. Each completed phase is saved before the next phase starts.
It verifies the frozen C2 start checkpoint, C5.1 pack stream, tokenizer,
validation packs, C5.1 control result, and C5.1 selected control checkpoint.

The source bundle and private artifact bundle need an exact upload approval
before upload. The staging script has a plan mode that computes their hashes and
destinations first. Publication, replication, promotion, and sealed-test access
keep their separate approval boundaries.
