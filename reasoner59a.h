#ifndef REASONER59A_H
#define REASONER59A_H

#include <stdint.h>

enum {
    R59A_GRID_CELLS = 4,
    R59A_MAX_OBJECTS = 3,
    R59A_COLORS = 3,
    R59A_SHAPES = 3,
    R59A_SIZES = 2,
    R59A_ATOMS = 8,
    R59A_RELATIONS = 6,
    R59A_SCENES = 25344,
    R59A_SMOKE_CONCEPTS = 10
};

typedef struct {
    uint8_t cell;
    uint8_t color;
    uint8_t shape;
    uint8_t size;
} r59a_object;

typedef struct {
    uint8_t object_count;
    r59a_object objects[R59A_MAX_OBJECTS];
} r59a_scene;

typedef enum {
    R59A_EXISTS = 0,
    R59A_ALL = 1,
    R59A_COUNT_EQ = 2,
    R59A_COUNT_GE = 3,
    R59A_EXISTS_AND = 4,
    R59A_EXISTS_XOR = 5,
    R59A_COUNT_COMPARE = 6,
    R59A_RELATION_EXISTS = 7,
    R59A_BOOLEAN_AND = 8,
    R59A_BOOLEAN_OR = 9
} r59a_concept_kind;

typedef struct {
    uint8_t kind;
    uint8_t legend[2];
    uint8_t parameter;
} r59a_concept;

typedef struct {
    uint32_t scene_count;
    uint32_t smoke_positive[R59A_SMOKE_CONCEPTS];
    uint64_t smoke_fnv1a[R59A_SMOKE_CONCEPTS];
} r59a_development_summary;

int r59a_scene_at(uint32_t index, r59a_scene *scene);
int r59a_evaluate(const r59a_concept *concept, const r59a_scene *scene);
int r59a_verify_exact(const r59a_concept *candidate,
                      const r59a_concept *target,
                      uint32_t *first_counterexample);
int r59a_run_development(r59a_development_summary *summary);
int r59a_write_development_json(const char *path,
                                const r59a_development_summary *summary);
int r59a_self_test(void);

#endif
