#ifndef WEIGHT_MULTIPLICITY_H
#define WEIGHT_MULTIPLICITY_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    WM_MAX_RANK = 8,
    WM_MAX_ROOTS = 240,
    WM_MAX_POSITIVE_ROOTS = 120,
    WM_BIG_LIMBS = 32,
    WM_DECIMAL_CAPACITY = 320
};

typedef enum {
    WM_OK = 0,
    WM_INVALID_ARGUMENT,
    WM_INVALID_CARTAN,
    WM_NOT_DOMINANT,
    WM_LIMIT_ERROR,
    WM_ARITHMETIC_ERROR,
    WM_MEMORY_ERROR
} WMStatus;

typedef struct {
    uint32_t limb[WM_BIG_LIMBS];
} WMBigUInt;

typedef struct {
    uint8_t rank;
    uint16_t count;
    int16_t coefficient[WM_MAX_POSITIVE_ROOTS][WM_MAX_RANK];
} WMPositiveRoots;

typedef struct {
    R0CartanMatrix cartan;
    uint32_t symmetrizer[WM_MAX_RANK];
    WMPositiveRoots positive_roots;
} WMOracle;

typedef struct {
    uint64_t memo_entries;
    uint64_t memo_entries_before;
    uint64_t memo_entries_added;
    uint64_t memo_hits;
    uint64_t memo_capacity_bytes;
    uint64_t memo_peak_allocated_bytes;
    uint64_t recurrence_terms;
    uint64_t recursive_weyl_folds;
    uint32_t maximum_level;
} WMQueryStats;

typedef struct WMRepresentationSession WMRepresentationSession;

WMStatus wm_oracle_init(const R0CartanMatrix *cartan, WMOracle *oracle,
                        char *error, size_t error_capacity);
WMStatus wm_oracle_init_type(const char *type, WMOracle *oracle, char *error,
                             size_t error_capacity);
WMStatus wm_weight_multiplicity(const WMOracle *oracle,
                                const int32_t highest_weight[WM_MAX_RANK],
                                const int32_t target_weight[WM_MAX_RANK],
                                WMBigUInt *multiplicity, WMQueryStats *stats,
                                char *error, size_t error_capacity);
WMStatus wm_representation_session_create(
    const WMOracle *oracle,
    const int32_t highest_weight[WM_MAX_RANK],
    size_t maximum_memo_bytes,
    WMRepresentationSession **session,
    char *error,
    size_t error_capacity);
WMStatus wm_representation_session_create_with_capacity(
    const WMOracle *oracle,
    const int32_t highest_weight[WM_MAX_RANK],
    size_t maximum_memo_bytes,
    size_t initial_memo_capacity,
    WMRepresentationSession **session,
    char *error,
    size_t error_capacity);
uint64_t wm_representation_memo_entry_bytes(void);
WMStatus wm_representation_session_multiplicity(
    WMRepresentationSession *session,
    const int32_t target_weight[WM_MAX_RANK],
    WMBigUInt *multiplicity,
    WMQueryStats *stats,
    char *error,
    size_t error_capacity);
uint64_t wm_representation_session_memo_entries(
    const WMRepresentationSession *session);
uint64_t wm_representation_session_memo_capacity_bytes(
    const WMRepresentationSession *session);
uint64_t wm_representation_session_memo_peak_allocated_bytes(
    const WMRepresentationSession *session);
void wm_representation_session_destroy(WMRepresentationSession *session);
WMStatus wm_big_to_decimal(const WMBigUInt *value, char *output,
                           size_t output_capacity);
int wm_big_equal_u32(const WMBigUInt *value, uint32_t expected);
const char *wm_status_name(WMStatus status);

#endif
