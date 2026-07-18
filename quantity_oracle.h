#ifndef QUANTITY_ORACLE_H
#define QUANTITY_ORACLE_H

#include <stddef.h>

/* Canonicalize one bounded user task into the only executable request allowed. */
int quantity_request_from_input(const char *input, char *request,
                                size_t capacity);

/* Execute a canonical request with exact bounded integer/rational arithmetic. */
int quantity_oracle_execute(const char *request, char *artifact,
                            size_t artifact_capacity, char *summary,
                            size_t summary_capacity);

#endif
