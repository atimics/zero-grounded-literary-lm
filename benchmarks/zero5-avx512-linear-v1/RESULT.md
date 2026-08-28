# ZERO.5 AVX-512 float linear result

OpenBLAS remains the selected linear backend. The custom AVX-512 float32
kernel was 50.01% slower on the locked four-worker C3.3 performance workload.

| Backend | Mean tokens/s | Mean elapsed | Change vs OpenBLAS |
| --- | ---: | ---: | ---: |
| OpenBLAS `sgemm` | 6,698.5 | 8.53 s | baseline |
| AVX-512 float32 | 3,348.5 | 16.93 s | -50.01% throughput |

Both repetitions used an Intel Xeon Platinum 8375C on an AWS
`c6i.4xlarge`, with four trainer workers and one BLAS thread per worker. The
order was balanced: OpenBLAS then AVX-512 in repetition one, and AVX-512 then
OpenBLAS in repetition two.

Correctness controls passed. Training loss, validation loss, and gradient norm
matched within the locked tolerance. Each backend produced the same checkpoint
across its two repetitions. Cross-backend checkpoints differed as expected
because AVX-512 changes float reduction order.

The result rejects this 4-row by 4-output kernel as a speed candidate. The
likely costs are repeated activation loads for each output tile and a lane
reduction for every dot product, while OpenBLAS keeps its optimized packing and
blocked kernels. That cause is an inference from the kernel structure, not a
separate hardware-counter measurement.

The run completed in 126 instance seconds for an estimated $0.0238. The sealed
test set remained closed, and the instance terminated automatically. This is a
performance result only, not a new C3.3 model result.
