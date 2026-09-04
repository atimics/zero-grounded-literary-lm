#include "reasoner59a.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>

static const r59a_concept r59a_smoke[R59A_SMOKE_CONCEPTS] = {
    {R59A_EXISTS, {0u, 3u}, 0u},
    {R59A_ALL, {3u, 0u}, 0u},
    {R59A_COUNT_EQ, {6u, 0u}, 2u},
    {R59A_COUNT_GE, {1u, 0u}, 2u},
    {R59A_EXISTS_AND, {0u, 3u}, 0u},
    {R59A_EXISTS_XOR, {2u, 7u}, 0u},
    {R59A_COUNT_COMPARE, {4u, 6u}, 1u},
    {R59A_RELATION_EXISTS, {0u, 3u}, 0u},
    {R59A_BOOLEAN_AND, {0u, 3u}, 2u},
    {R59A_BOOLEAN_OR, {5u, 7u}, 2u}
};

static uint32_t r59a_pow18(uint8_t power)
{
    uint32_t result = 1u;
    while (power-- > 0u) result *= 18u;
    return result;
}

static void r59a_decode_object(uint32_t code, uint8_t cell,
                               r59a_object *object)
{
    object->cell = cell;
    object->color = (uint8_t)(code % R59A_COLORS);
    code /= R59A_COLORS;
    object->shape = (uint8_t)(code % R59A_SHAPES);
    code /= R59A_SHAPES;
    object->size = (uint8_t)(code % R59A_SIZES);
}

static int r59a_fill_scene(uint8_t count, const uint8_t cells[3],
                           uint32_t assignment, r59a_scene *scene)
{
    uint8_t object;
    if (!scene || count < 1u || count > R59A_MAX_OBJECTS) return 1;
    memset(scene, 0, sizeof(*scene));
    scene->object_count = count;
    for (object = 0; object < count; ++object) {
        r59a_decode_object(assignment % 18u, cells[object],
                           &scene->objects[object]);
        assignment /= 18u;
    }
    return assignment != 0u;
}

int r59a_scene_at(uint32_t index, r59a_scene *scene)
{
    uint8_t count, a, b, c;
    for (count = 1u; count <= R59A_MAX_OBJECTS; ++count) {
        uint32_t assignments = r59a_pow18(count);
        if (count == 1u) {
            for (a = 0u; a < R59A_GRID_CELLS; ++a) {
                uint8_t cells[3] = {a, 0u, 0u};
                if (index < assignments)
                    return r59a_fill_scene(count, cells, index, scene);
                index -= assignments;
            }
        } else if (count == 2u) {
            for (a = 0u; a < R59A_GRID_CELLS; ++a)
                for (b = (uint8_t)(a + 1u); b < R59A_GRID_CELLS; ++b) {
                    uint8_t cells[3] = {a, b, 0u};
                    if (index < assignments)
                        return r59a_fill_scene(count, cells, index, scene);
                    index -= assignments;
                }
        } else {
            for (a = 0u; a < R59A_GRID_CELLS; ++a)
                for (b = (uint8_t)(a + 1u); b < R59A_GRID_CELLS; ++b)
                    for (c = (uint8_t)(b + 1u); c < R59A_GRID_CELLS; ++c) {
                        uint8_t cells[3] = {a, b, c};
                        if (index < assignments)
                            return r59a_fill_scene(count, cells, index, scene);
                        index -= assignments;
                    }
        }
    }
    return 1;
}

static int r59a_matches(uint8_t atom, const r59a_object *object)
{
    if (atom < 3u) return object->color == atom;
    if (atom < 6u) return object->shape == atom - 3u;
    if (atom < 8u) return object->size == atom - 6u;
    return 0;
}

static uint8_t r59a_count(uint8_t atom, const r59a_scene *scene)
{
    uint8_t count = 0u;
    uint8_t object;
    for (object = 0u; object < scene->object_count; ++object)
        count += (uint8_t)r59a_matches(atom, &scene->objects[object]);
    return count;
}

static int r59a_relation(uint8_t relation, uint8_t left, uint8_t right)
{
    uint8_t left_row = left / 2u;
    uint8_t left_column = left % 2u;
    uint8_t right_row = right / 2u;
    uint8_t right_column = right % 2u;
    switch (relation) {
        case 0u: return left_column < right_column;
        case 1u: return left_column > right_column;
        case 2u: return left_row < right_row;
        case 3u: return left_row > right_row;
        case 4u: return left_row == right_row;
        case 5u: return left_column == right_column;
        default: return 0;
    }
}

static int r59a_valid_scene(const r59a_scene *scene)
{
    uint8_t left, right;
    if (!scene || scene->object_count < 1u ||
        scene->object_count > R59A_MAX_OBJECTS) return 0;
    for (left = 0u; left < scene->object_count; ++left) {
        const r59a_object *object = &scene->objects[left];
        if (object->cell >= R59A_GRID_CELLS ||
            object->color >= R59A_COLORS ||
            object->shape >= R59A_SHAPES ||
            object->size >= R59A_SIZES) return 0;
        for (right = (uint8_t)(left + 1u);
             right < scene->object_count; ++right)
            if (object->cell == scene->objects[right].cell) return 0;
    }
    return 1;
}

static int r59a_valid_concept(const r59a_concept *concept)
{
    if (!concept || concept->kind > R59A_BOOLEAN_OR ||
        concept->legend[0] >= R59A_ATOMS ||
        concept->legend[1] >= R59A_ATOMS ||
        concept->legend[0] == concept->legend[1]) return 0;
    switch (concept->kind) {
        case R59A_EXISTS:
        case R59A_ALL:
        case R59A_EXISTS_AND:
        case R59A_EXISTS_XOR:
            return concept->parameter == 0u;
        case R59A_COUNT_EQ:
            return concept->parameter >= 1u && concept->parameter <= 3u;
        case R59A_COUNT_GE:
        case R59A_BOOLEAN_AND:
        case R59A_BOOLEAN_OR:
            return concept->parameter >= 2u && concept->parameter <= 3u;
        case R59A_COUNT_COMPARE:
            return concept->parameter <= 2u;
        case R59A_RELATION_EXISTS:
            return concept->parameter < R59A_RELATIONS;
        default:
            return 0;
    }
}

int r59a_evaluate(const r59a_concept *concept, const r59a_scene *scene)
{
    uint8_t first, second, left, right;
    if (!r59a_valid_concept(concept) || !r59a_valid_scene(scene)) return -1;
    first = r59a_count(concept->legend[0], scene);
    second = r59a_count(concept->legend[1], scene);
    switch (concept->kind) {
        case R59A_EXISTS: return first > 0u;
        case R59A_ALL: return first == scene->object_count;
        case R59A_COUNT_EQ: return first == concept->parameter;
        case R59A_COUNT_GE: return first >= concept->parameter;
        case R59A_EXISTS_AND:
            for (left = 0u; left < scene->object_count; ++left)
                if (r59a_matches(concept->legend[0], &scene->objects[left]) &&
                    r59a_matches(concept->legend[1], &scene->objects[left]))
                    return 1;
            return 0;
        case R59A_EXISTS_XOR: return (first > 0u) != (second > 0u);
        case R59A_COUNT_COMPARE:
            if (concept->parameter == 0u) return first == second;
            if (concept->parameter == 1u) return first > second;
            if (concept->parameter == 2u) return first < second;
            return -1;
        case R59A_RELATION_EXISTS:
            for (left = 0u; left < scene->object_count; ++left)
                for (right = 0u; right < scene->object_count; ++right)
                    if (left != right &&
                        r59a_matches(concept->legend[0],
                                     &scene->objects[left]) &&
                        r59a_matches(concept->legend[1],
                                     &scene->objects[right]) &&
                        r59a_relation(concept->parameter,
                                      scene->objects[left].cell,
                                      scene->objects[right].cell)) return 1;
            return 0;
        case R59A_BOOLEAN_AND:
            return first > 0u && second >= concept->parameter;
        case R59A_BOOLEAN_OR:
            return first > 0u || second >= concept->parameter;
        default: return -1;
    }
}

int r59a_verify_exact(const r59a_concept *candidate,
                      const r59a_concept *target,
                      uint32_t *first_counterexample)
{
    uint32_t index;
    r59a_scene scene;
    if (first_counterexample) *first_counterexample = UINT32_MAX;
    for (index = 0u; index < R59A_SCENES; ++index) {
        int candidate_value, target_value;
        if (r59a_scene_at(index, &scene) != 0) return 0;
        candidate_value = r59a_evaluate(candidate, &scene);
        target_value = r59a_evaluate(target, &scene);
        if (candidate_value < 0 || target_value < 0) return 0;
        if (candidate_value != target_value) {
            if (first_counterexample) *first_counterexample = index;
            return 0;
        }
    }
    return 1;
}

static uint64_t r59a_fnv1a_update(uint64_t hash, uint8_t value)
{
    return (hash ^ value) * UINT64_C(1099511628211);
}

int r59a_run_development(r59a_development_summary *summary)
{
    uint32_t index;
    if (!summary) return 1;
    memset(summary, 0, sizeof(*summary));
    for (index = 0u; index < R59A_SCENES; ++index) {
        r59a_scene scene;
        uint32_t concept;
        if (r59a_scene_at(index, &scene) != 0) return 1;
        ++summary->scene_count;
        for (concept = 0u; concept < R59A_SMOKE_CONCEPTS; ++concept) {
            int value = r59a_evaluate(&r59a_smoke[concept], &scene);
            if (value < 0) return 1;
            summary->smoke_positive[concept] += (uint32_t)value;
            if (index == 0u)
                summary->smoke_fnv1a[concept] = UINT64_C(14695981039346656037);
            summary->smoke_fnv1a[concept] = r59a_fnv1a_update(
                summary->smoke_fnv1a[concept], (uint8_t)value);
        }
    }
    return summary->scene_count != R59A_SCENES;
}

int r59a_write_development_json(const char *path,
                                const r59a_development_summary *summary)
{
    FILE *output;
    uint32_t index;
    if (!path || !summary) return 1;
    output = fopen(path, "wb");
    if (!output) return 1;
    if (fprintf(output,
        "{\n  \"schema\": \"zero.reasoner59a_core_development.v1\",\n"
        "  \"status\": \"development-only\",\n"
        "  \"execution_authorized\": false,\n"
        "  \"scene_count\": %u,\n  \"smoke_behaviors\": [\n",
        summary->scene_count) < 0) {
        fclose(output);
        return 1;
    }
    for (index = 0u; index < R59A_SMOKE_CONCEPTS; ++index)
        if (fprintf(output,
            "    {\"index\": %u, \"positive_scenes\": %u, "
            "\"fnv1a64\": \"%016" PRIx64 "\"}%s\n",
            index, summary->smoke_positive[index],
            summary->smoke_fnv1a[index],
            index + 1u == R59A_SMOKE_CONCEPTS ? "" : ",") < 0) {
            fclose(output);
            return 1;
        }
    if (fputs("  ]\n}\n", output) == EOF || fclose(output) != 0) return 1;
    return 0;
}

int r59a_self_test(void)
{
    r59a_development_summary summary;
    r59a_scene scene;
    uint32_t index, counterexample;
    r59a_concept first = r59a_smoke[0];
    r59a_concept second = r59a_smoke[1];
    if (r59a_run_development(&summary) != 0 ||
        summary.scene_count != R59A_SCENES) return 1;
    if (r59a_scene_at(R59A_SCENES, &scene) == 0) return 1;
    for (index = 0u; index < R59A_SCENES; ++index) {
        uint8_t object;
        if (r59a_scene_at(index, &scene) != 0 ||
            scene.object_count < 1u ||
            scene.object_count > R59A_MAX_OBJECTS) return 1;
        for (object = 1u; object < scene.object_count; ++object)
            if (scene.objects[object - 1u].cell >= scene.objects[object].cell)
                return 1;
    }
    if (!r59a_verify_exact(&first, &first, &counterexample) ||
        counterexample != UINT32_MAX) return 1;
    if (r59a_verify_exact(&first, &second, &counterexample) ||
        counterexample >= R59A_SCENES) return 1;
    scene.object_count = (uint8_t)(R59A_MAX_OBJECTS + 1u);
    if (r59a_evaluate(&first, &scene) >= 0) return 1;
    if (r59a_scene_at(0u, &scene) != 0) return 1;
    scene.objects[0].color = R59A_COLORS;
    if (r59a_evaluate(&first, &scene) >= 0) return 1;
    if (r59a_scene_at(72u, &scene) != 0 || scene.object_count != 2u) return 1;
    scene.objects[1].cell = scene.objects[0].cell;
    if (r59a_evaluate(&first, &scene) >= 0) return 1;
    if (r59a_scene_at(0u, &scene) != 0) return 1;
    first.parameter = 4u;
    if (r59a_evaluate(&first, &scene) >= 0) return 1;
    return 0;
}
