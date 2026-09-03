# C6.1 startup safety

The current evaluation instance script installs a shutdown handler before its
first startup command. Metadata requests have a five-second connection limit
and a fifteen-second total limit. The launch-time deadline then takes over.

The local regression check covers token failure, tag failure, invalid metadata,
and an expired deadline. Each case requests shutdown and keeps its failure code.
The check uses mocked commands.

The completed experiment keeps its original contract, authorization, result,
and receipt bytes. The exact executed instance script is preserved in
`history/evaluation-user-data-v1.sh`. `runtime-safety-amendment.json` links
that original hash to the current script. The recovery check verifies both.

This maintenance record grants zero executions. Any future run follows its own
authorization and execution lock.
