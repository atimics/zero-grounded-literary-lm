#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * logic_corpus.c -- deterministic, mechanically checked logic corpus data.
 *
 * The object language is a small propositional natural-deduction calculus
 * whose atoms describe hereditarily finite sets.  Set values are constructed
 * canonically from the empty set, pairing, union, and the von Neumann
 * successor.  The trusted checker validates logical proof terms and decides
 * atomic set facts in that finite universe.
 *
 * This is deliberately a finite fragment rather than a claim to decide ZF.
 * It produces an unbounded stream of finite, reproducible proof examples.
 */

#define ARENA_TERMS 2048
#define ARENA_FORMULAS 4096
#define ARENA_PROOFS 4096
#define MAX_CONTEXT 64
#define MAX_SETS 64
#define TEXT_CAPACITY 8192

typedef enum {
    TERM_EMPTY,
    TERM_SUCCESSOR,
    TERM_PAIR,
    TERM_UNION
} TermKind;

typedef struct Term Term;
struct Term {
    TermKind kind;
    Term *left;
    Term *right;
};

typedef enum {
    FORM_MEMBER,
    FORM_EQUAL,
    FORM_SUBSET,
    FORM_FALSE,
    FORM_AND,
    FORM_IMPLIES
} FormulaKind;

typedef struct Formula Formula;
struct Formula {
    FormulaKind kind;
    union {
        struct {
            Term *left;
            Term *right;
        } terms;
        struct {
            Formula *left;
            Formula *right;
        } formulas;
    } value;
};

typedef enum {
    PROOF_HYPOTHESIS,
    PROOF_VALIDATE,
    PROOF_IMP_INTRO,
    PROOF_IMP_ELIM,
    PROOF_AND_INTRO,
    PROOF_AND_LEFT,
    PROOF_AND_RIGHT
} ProofKind;

typedef struct Proof Proof;
struct Proof {
    ProofKind kind;
    int index;
    Formula *formula;
    Proof *left;
    Proof *right;
};

typedef struct {
    Term terms[ARENA_TERMS];
    Formula formulas[ARENA_FORMULAS];
    Proof proofs[ARENA_PROOFS];
    size_t term_count;
    size_t formula_count;
    size_t proof_count;
} Arena;

typedef struct {
    uint64_t state;
} Rng;

typedef struct {
    uint64_t elements[MAX_SETS];
    int count;
} Universe;

typedef struct {
    char *data;
    size_t capacity;
    size_t length;
    int overflow;
} Writer;

typedef struct {
    const char *text;
    size_t length;
    size_t position;
    int error;
    Arena *arena;
} Parser;

typedef struct {
    Arena arena;
    Universe universe;
    Formula *context[MAX_CONTEXT];
    int context_count;
} Checker;

typedef struct {
    Formula *theorem;
    Proof *proof;
    const char *task;
    const char *result;
} Example;

static void fail(const char *message)
{
    fprintf(stderr, "error: %s\n", message);
    exit(EXIT_FAILURE);
}

static void fail_path(const char *action, const char *path)
{
    fprintf(stderr, "error: could not %s '%s': %s\n", action, path,
            strerror(errno));
    exit(EXIT_FAILURE);
}

static long parse_long(const char *text, const char *option)
{
    char *end = NULL;
    long value;
    errno = 0;
    value = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0') {
        fprintf(stderr, "error: invalid integer for %s: '%s'\n", option,
                text);
        exit(EXIT_FAILURE);
    }
    return value;
}

static int parse_int(const char *text, const char *option)
{
    long value = parse_long(text, option);
    if (value < INT_MIN || value > INT_MAX) {
        fprintf(stderr, "error: integer out of range for %s: '%s'\n", option,
                text);
        exit(EXIT_FAILURE);
    }
    return (int)value;
}

static void arena_reset(Arena *arena)
{
    memset(arena, 0, sizeof(*arena));
}

static Term *term_new(Arena *arena, TermKind kind, Term *left, Term *right)
{
    Term *term;
    if (arena->term_count == ARENA_TERMS) fail("term arena exhausted");
    term = &arena->terms[arena->term_count++];
    term->kind = kind;
    term->left = left;
    term->right = right;
    return term;
}

static Formula *formula_terms(Arena *arena, FormulaKind kind, Term *left,
                              Term *right)
{
    Formula *formula;
    if (arena->formula_count == ARENA_FORMULAS) fail("formula arena exhausted");
    formula = &arena->formulas[arena->formula_count++];
    formula->kind = kind;
    formula->value.terms.left = left;
    formula->value.terms.right = right;
    return formula;
}

static Formula *formula_binary(Arena *arena, FormulaKind kind, Formula *left,
                               Formula *right)
{
    Formula *formula;
    if (arena->formula_count == ARENA_FORMULAS) fail("formula arena exhausted");
    formula = &arena->formulas[arena->formula_count++];
    formula->kind = kind;
    formula->value.formulas.left = left;
    formula->value.formulas.right = right;
    return formula;
}

static Formula *formula_false(Arena *arena)
{
    Formula *formula;
    if (arena->formula_count == ARENA_FORMULAS) fail("formula arena exhausted");
    formula = &arena->formulas[arena->formula_count++];
    formula->kind = FORM_FALSE;
    return formula;
}

static Proof *proof_new(Arena *arena, ProofKind kind, int index,
                        Formula *formula, Proof *left, Proof *right)
{
    Proof *proof;
    if (arena->proof_count == ARENA_PROOFS) fail("proof arena exhausted");
    proof = &arena->proofs[arena->proof_count++];
    proof->kind = kind;
    proof->index = index;
    proof->formula = formula;
    proof->left = left;
    proof->right = right;
    return proof;
}

static uint64_t rng_next(Rng *rng)
{
    uint64_t x = rng->state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    rng->state = x;
    return x * UINT64_C(2685821657736338717);
}

static unsigned rng_bounded(Rng *rng, unsigned bound)
{
    return bound == 0 ? 0 : (unsigned)(rng_next(rng) % bound);
}

static void universe_reset(Universe *universe)
{
    memset(universe, 0, sizeof(*universe));
    universe->elements[0] = 0;
    universe->count = 1;
}

static int universe_intern(Universe *universe, uint64_t elements)
{
    int i;
    for (i = 0; i < universe->count; ++i) {
        if (universe->elements[i] == elements) return i;
    }
    if (universe->count == MAX_SETS) return -1;
    universe->elements[universe->count] = elements;
    return universe->count++;
}

static int evaluate_term(Universe *universe, const Term *term)
{
    int left;
    int right;
    uint64_t elements;
    int i;
    if (term == NULL) return -1;
    switch (term->kind) {
    case TERM_EMPTY:
        return 0;
    case TERM_SUCCESSOR:
        left = evaluate_term(universe, term->left);
        if (left < 0) return -1;
        elements = universe->elements[left] | (UINT64_C(1) << left);
        return universe_intern(universe, elements);
    case TERM_PAIR:
        left = evaluate_term(universe, term->left);
        right = evaluate_term(universe, term->right);
        if (left < 0 || right < 0) return -1;
        elements = (UINT64_C(1) << left) | (UINT64_C(1) << right);
        return universe_intern(universe, elements);
    case TERM_UNION:
        left = evaluate_term(universe, term->left);
        if (left < 0) return -1;
        elements = 0;
        for (i = 0; i < universe->count; ++i) {
            if ((universe->elements[left] & (UINT64_C(1) << i)) != 0) {
                elements |= universe->elements[i];
            }
        }
        return universe_intern(universe, elements);
    }
    return -1;
}

static int evaluate_atomic(Universe *universe, const Formula *formula)
{
    int left;
    int right;
    if (formula == NULL ||
        (formula->kind != FORM_MEMBER && formula->kind != FORM_EQUAL &&
         formula->kind != FORM_SUBSET)) {
        return 0;
    }
    left = evaluate_term(universe, formula->value.terms.left);
    right = evaluate_term(universe, formula->value.terms.right);
    if (left < 0 || right < 0) return 0;
    if (formula->kind == FORM_MEMBER) {
        return (universe->elements[right] & (UINT64_C(1) << left)) != 0;
    }
    if (formula->kind == FORM_EQUAL) return left == right;
    return (universe->elements[left] & ~universe->elements[right]) == 0;
}

static int term_equal(const Term *left, const Term *right)
{
    if (left == right) return 1;
    if (left == NULL || right == NULL || left->kind != right->kind) return 0;
    switch (left->kind) {
    case TERM_EMPTY:
        return 1;
    case TERM_SUCCESSOR:
    case TERM_UNION:
        return term_equal(left->left, right->left);
    case TERM_PAIR:
        return term_equal(left->left, right->left) &&
               term_equal(left->right, right->right);
    }
    return 0;
}

static int formula_equal(const Formula *left, const Formula *right)
{
    if (left == right) return 1;
    if (left == NULL || right == NULL || left->kind != right->kind) return 0;
    switch (left->kind) {
    case FORM_MEMBER:
    case FORM_EQUAL:
    case FORM_SUBSET:
        return term_equal(left->value.terms.left, right->value.terms.left) &&
               term_equal(left->value.terms.right, right->value.terms.right);
    case FORM_FALSE:
        return 1;
    case FORM_AND:
    case FORM_IMPLIES:
        return formula_equal(left->value.formulas.left,
                             right->value.formulas.left) &&
               formula_equal(left->value.formulas.right,
                             right->value.formulas.right);
    }
    return 0;
}

static int check_proof_recursive(Checker *checker, const Proof *proof,
                                 Formula **conclusion)
{
    Formula *left;
    Formula *right;
    if (proof == NULL) return 0;
    switch (proof->kind) {
    case PROOF_HYPOTHESIS:
        if (proof->index < 0 || proof->index >= checker->context_count) return 0;
        *conclusion = checker->context[checker->context_count - 1 - proof->index];
        return 1;
    case PROOF_VALIDATE:
        universe_reset(&checker->universe);
        if (!evaluate_atomic(&checker->universe, proof->formula)) return 0;
        *conclusion = proof->formula;
        return 1;
    case PROOF_IMP_INTRO:
        if (checker->context_count == MAX_CONTEXT) return 0;
        checker->context[checker->context_count++] = proof->formula;
        if (!check_proof_recursive(checker, proof->left, &left)) {
            --checker->context_count;
            return 0;
        }
        --checker->context_count;
        *conclusion = formula_binary(&checker->arena, FORM_IMPLIES,
                                     proof->formula, left);
        return 1;
    case PROOF_IMP_ELIM:
        if (!check_proof_recursive(checker, proof->left, &left) ||
            !check_proof_recursive(checker, proof->right, &right) ||
            left->kind != FORM_IMPLIES ||
            !formula_equal(left->value.formulas.left, right)) {
            return 0;
        }
        *conclusion = left->value.formulas.right;
        return 1;
    case PROOF_AND_INTRO:
        if (!check_proof_recursive(checker, proof->left, &left) ||
            !check_proof_recursive(checker, proof->right, &right)) {
            return 0;
        }
        *conclusion = formula_binary(&checker->arena, FORM_AND, left, right);
        return 1;
    case PROOF_AND_LEFT:
    case PROOF_AND_RIGHT:
        if (!check_proof_recursive(checker, proof->left, &left) ||
            left->kind != FORM_AND) {
            return 0;
        }
        *conclusion = proof->kind == PROOF_AND_LEFT
                          ? left->value.formulas.left
                          : left->value.formulas.right;
        return 1;
    }
    return 0;
}

static int proof_matches(Arena *source, Formula *theorem, Proof *proof)
{
    Checker checker;
    Formula *conclusion = NULL;
    size_t term_count = source->term_count;
    size_t formula_count = source->formula_count;
    size_t proof_count = source->proof_count;
    int valid;
    memset(&checker, 0, sizeof(checker));
    memcpy(&checker.arena, source, sizeof(*source));
    valid = check_proof_recursive(&checker, proof, &conclusion) &&
            formula_equal(theorem, conclusion);
    source->term_count = term_count;
    source->formula_count = formula_count;
    source->proof_count = proof_count;
    return valid;
}

static void writer_character(Writer *writer, char value)
{
    if (writer->length + 1 >= writer->capacity) {
        writer->overflow = 1;
        return;
    }
    writer->data[writer->length++] = value;
    writer->data[writer->length] = '\0';
}

static void writer_text(Writer *writer, const char *text)
{
    while (*text != '\0') writer_character(writer, *text++);
}

static void write_term(Writer *writer, const Term *term)
{
    switch (term->kind) {
    case TERM_EMPTY:
        writer_character(writer, '0');
        break;
    case TERM_SUCCESSOR:
        writer_text(writer, "s(");
        write_term(writer, term->left);
        writer_character(writer, ')');
        break;
    case TERM_PAIR:
        writer_text(writer, "p(");
        write_term(writer, term->left);
        writer_character(writer, ',');
        write_term(writer, term->right);
        writer_character(writer, ')');
        break;
    case TERM_UNION:
        writer_text(writer, "u(");
        write_term(writer, term->left);
        writer_character(writer, ')');
        break;
    }
}

static void write_formula(Writer *writer, const Formula *formula)
{
    char prefix = '\0';
    switch (formula->kind) {
    case FORM_MEMBER: prefix = 'm'; break;
    case FORM_EQUAL: prefix = 'q'; break;
    case FORM_SUBSET: prefix = 'b'; break;
    case FORM_FALSE:
        writer_character(writer, 'f');
        return;
    case FORM_AND: prefix = 'a'; break;
    case FORM_IMPLIES: prefix = 'i'; break;
    }
    writer_character(writer, prefix);
    writer_character(writer, '(');
    if (formula->kind == FORM_MEMBER || formula->kind == FORM_EQUAL ||
        formula->kind == FORM_SUBSET) {
        write_term(writer, formula->value.terms.left);
        writer_character(writer, ',');
        write_term(writer, formula->value.terms.right);
    } else {
        write_formula(writer, formula->value.formulas.left);
        writer_character(writer, ',');
        write_formula(writer, formula->value.formulas.right);
    }
    writer_character(writer, ')');
}

static void write_number(Writer *writer, unsigned value)
{
    char digits[16];
    int count = 0;
    do {
        digits[count++] = (char)('0' + value % 10);
        value /= 10;
    } while (value != 0 && count < (int)sizeof(digits));
    while (count > 0) writer_character(writer, digits[--count]);
}

static void write_proof(Writer *writer, const Proof *proof)
{
    switch (proof->kind) {
    case PROOF_HYPOTHESIS:
        writer_character(writer, 'h');
        write_number(writer, (unsigned)proof->index);
        return;
    case PROOF_VALIDATE:
        writer_text(writer, "v(");
        write_formula(writer, proof->formula);
        writer_character(writer, ')');
        return;
    case PROOF_IMP_INTRO:
        writer_text(writer, "ii(");
        write_formula(writer, proof->formula);
        writer_character(writer, ',');
        write_proof(writer, proof->left);
        writer_character(writer, ')');
        return;
    case PROOF_IMP_ELIM:
        writer_text(writer, "ie(");
        break;
    case PROOF_AND_INTRO:
        writer_text(writer, "ai(");
        break;
    case PROOF_AND_LEFT:
        writer_text(writer, "al(");
        write_proof(writer, proof->left);
        writer_character(writer, ')');
        return;
    case PROOF_AND_RIGHT:
        writer_text(writer, "ar(");
        write_proof(writer, proof->left);
        writer_character(writer, ')');
        return;
    }
    write_proof(writer, proof->left);
    writer_character(writer, ',');
    write_proof(writer, proof->right);
    writer_character(writer, ')');
}

static int parser_take(Parser *parser, char value)
{
    if (parser->position >= parser->length ||
        parser->text[parser->position] != value) {
        parser->error = 1;
        return 0;
    }
    ++parser->position;
    return 1;
}

static int parser_starts(const Parser *parser, const char *text)
{
    size_t length = strlen(text);
    return parser->position <= parser->length &&
           length <= parser->length - parser->position &&
           memcmp(parser->text + parser->position, text, length) == 0;
}

static Term *parse_term(Parser *parser)
{
    char tag;
    Term *left;
    Term *right = NULL;
    TermKind kind;
    if (parser->position >= parser->length) {
        parser->error = 1;
        return NULL;
    }
    tag = parser->text[parser->position++];
    if (tag == '0') return term_new(parser->arena, TERM_EMPTY, NULL, NULL);
    if (tag == 's') kind = TERM_SUCCESSOR;
    else if (tag == 'p') kind = TERM_PAIR;
    else if (tag == 'u') kind = TERM_UNION;
    else {
        parser->error = 1;
        return NULL;
    }
    if (!parser_take(parser, '(')) return NULL;
    left = parse_term(parser);
    if (kind == TERM_PAIR) {
        if (!parser_take(parser, ',')) return NULL;
        right = parse_term(parser);
    }
    if (!parser_take(parser, ')')) return NULL;
    return term_new(parser->arena, kind, left, right);
}

static Formula *parse_formula(Parser *parser)
{
    char tag;
    FormulaKind kind;
    if (parser->position >= parser->length) {
        parser->error = 1;
        return NULL;
    }
    tag = parser->text[parser->position++];
    if (tag == 'f') return formula_false(parser->arena);
    if (tag == 'm') kind = FORM_MEMBER;
    else if (tag == 'q') kind = FORM_EQUAL;
    else if (tag == 'b') kind = FORM_SUBSET;
    else if (tag == 'a') kind = FORM_AND;
    else if (tag == 'i') kind = FORM_IMPLIES;
    else {
        parser->error = 1;
        return NULL;
    }
    if (!parser_take(parser, '(')) return NULL;
    if (kind == FORM_MEMBER || kind == FORM_EQUAL || kind == FORM_SUBSET) {
        Term *left = parse_term(parser);
        Term *right;
        if (!parser_take(parser, ',')) return NULL;
        right = parse_term(parser);
        if (!parser_take(parser, ')')) return NULL;
        return formula_terms(parser->arena, kind, left, right);
    } else {
        Formula *left = parse_formula(parser);
        Formula *right;
        if (!parser_take(parser, ',')) return NULL;
        right = parse_formula(parser);
        if (!parser_take(parser, ')')) return NULL;
        return formula_binary(parser->arena, kind, left, right);
    }
}

static Proof *parse_proof(Parser *parser)
{
    char tag;
    if (parser->position >= parser->length) {
        parser->error = 1;
        return NULL;
    }
    tag = parser->text[parser->position];
    if (tag == 'h') {
        unsigned value = 0;
        ++parser->position;
        if (parser->position >= parser->length ||
            parser->text[parser->position] < '0' ||
            parser->text[parser->position] > '9') {
            parser->error = 1;
            return NULL;
        }
        while (parser->position < parser->length &&
               parser->text[parser->position] >= '0' &&
               parser->text[parser->position] <= '9') {
            unsigned digit = (unsigned)(parser->text[parser->position++] - '0');
            if (value > (unsigned)(INT_MAX - (int)digit) / 10U) {
                parser->error = 1;
                return NULL;
            }
            value = value * 10U + digit;
        }
        return proof_new(parser->arena, PROOF_HYPOTHESIS, (int)value, NULL,
                         NULL, NULL);
    }
    if (tag == 'v') {
        Formula *formula;
        parser->position++;
        if (!parser_take(parser, '(')) return NULL;
        formula = parse_formula(parser);
        if (!parser_take(parser, ')')) return NULL;
        return proof_new(parser->arena, PROOF_VALIDATE, 0, formula, NULL, NULL);
    }
    if (parser_starts(parser, "ii(")) {
        Formula *formula;
        Proof *body;
        parser->position += 3;
        formula = parse_formula(parser);
        if (!parser_take(parser, ',')) return NULL;
        body = parse_proof(parser);
        if (!parser_take(parser, ')')) return NULL;
        return proof_new(parser->arena, PROOF_IMP_INTRO, 0, formula, body, NULL);
    }
    if (parser_starts(parser, "ie(") || parser_starts(parser, "ai(")) {
        ProofKind kind = parser->text[parser->position] == 'i'
                             ? PROOF_IMP_ELIM
                             : PROOF_AND_INTRO;
        Proof *left;
        Proof *right;
        parser->position += 3;
        left = parse_proof(parser);
        if (!parser_take(parser, ',')) return NULL;
        right = parse_proof(parser);
        if (!parser_take(parser, ')')) return NULL;
        return proof_new(parser->arena, kind, 0, NULL, left, right);
    }
    if (parser_starts(parser, "al(") || parser_starts(parser, "ar(")) {
        ProofKind kind = parser->text[parser->position + 1] == 'l'
                             ? PROOF_AND_LEFT
                             : PROOF_AND_RIGHT;
        Proof *body;
        parser->position += 3;
        body = parse_proof(parser);
        if (!parser_take(parser, ')')) return NULL;
        return proof_new(parser->arena, kind, 0, NULL, body, NULL);
    }
    parser->error = 1;
    return NULL;
}

static Formula *parse_complete_formula(Arena *arena, const char *text)
{
    Parser parser;
    Formula *formula;
    parser.text = text;
    parser.length = strlen(text);
    parser.position = 0;
    parser.error = 0;
    parser.arena = arena;
    formula = parse_formula(&parser);
    if (parser.error || text[parser.position] != '\0') return NULL;
    return formula;
}

static Proof *parse_complete_proof(Arena *arena, const char *text)
{
    Parser parser;
    Proof *proof;
    parser.text = text;
    parser.length = strlen(text);
    parser.position = 0;
    parser.error = 0;
    parser.arena = arena;
    proof = parse_proof(&parser);
    if (parser.error || text[parser.position] != '\0') return NULL;
    return proof;
}

static Term *generate_term(Arena *arena, Rng *rng, int depth)
{
    unsigned choice;
    if (depth <= 0) return term_new(arena, TERM_EMPTY, NULL, NULL);
    choice = rng_bounded(rng, 100);
    if (choice < 25) return term_new(arena, TERM_EMPTY, NULL, NULL);
    if (choice < 55) {
        return term_new(arena, TERM_SUCCESSOR,
                        generate_term(arena, rng, depth - 1), NULL);
    }
    if (choice < 85) {
        return term_new(arena, TERM_PAIR,
                        generate_term(arena, rng, depth - 1),
                        generate_term(arena, rng, depth - 1));
    }
    return term_new(arena, TERM_UNION,
                    generate_term(arena, rng, depth - 1), NULL);
}

static Formula *generate_atom(Arena *arena, Rng *rng, int depth)
{
    FormulaKind kind;
    switch (rng_bounded(rng, 3)) {
    case 0: kind = FORM_MEMBER; break;
    case 1: kind = FORM_EQUAL; break;
    default: kind = FORM_SUBSET; break;
    }
    return formula_terms(arena, kind, generate_term(arena, rng, depth),
                         generate_term(arena, rng, depth));
}

static Formula *generate_true_atom(Arena *arena, Rng *rng, int depth)
{
    Term *term = generate_term(arena, rng, depth);
    unsigned choice = rng_bounded(rng, 3);
    if (choice == 0) return formula_terms(arena, FORM_EQUAL, term, term);
    if (choice == 1) {
        Term *successor = term_new(arena, TERM_SUCCESSOR, term, NULL);
        return formula_terms(arena, FORM_MEMBER, term, successor);
    }
    return formula_terms(arena, FORM_SUBSET, term,
                         term_new(arena, TERM_SUCCESSOR, term, NULL));
}

static Formula *generate_false_atom(Arena *arena, Rng *rng, int depth)
{
    Term *term = generate_term(arena, rng, depth);
    return formula_terms(arena, FORM_MEMBER, term, term);
}

static Proof *hypothesis(Arena *arena, int index)
{
    return proof_new(arena, PROOF_HYPOTHESIS, index, NULL, NULL, NULL);
}

static Proof *validate(Arena *arena, Formula *formula)
{
    return proof_new(arena, PROOF_VALIDATE, 0, formula, NULL, NULL);
}

static Proof *imp_intro(Arena *arena, Formula *formula, Proof *body)
{
    return proof_new(arena, PROOF_IMP_INTRO, 0, formula, body, NULL);
}

static Proof *imp_elim(Arena *arena, Proof *left, Proof *right)
{
    return proof_new(arena, PROOF_IMP_ELIM, 0, NULL, left, right);
}

static Proof *and_intro(Arena *arena, Proof *left, Proof *right)
{
    return proof_new(arena, PROOF_AND_INTRO, 0, NULL, left, right);
}

static Proof *and_left(Arena *arena, Proof *body)
{
    return proof_new(arena, PROOF_AND_LEFT, 0, NULL, body, NULL);
}

static Proof *and_right(Arena *arena, Proof *body)
{
    return proof_new(arena, PROOF_AND_RIGHT, 0, NULL, body, NULL);
}

static void generate_valid_example(Arena *arena, Rng *rng, int depth,
                                   int validation, Example *example)
{
    Formula *p = generate_atom(arena, rng, depth);
    Formula *q = generate_atom(arena, rng, depth);
    Formula *r = generate_atom(arena, rng, depth);
    Formula *source;
    Formula *target;
    unsigned template_index = validation ? 6 + rng_bounded(rng, 4)
                                         : rng_bounded(rng, 6);
    switch (template_index) {
    case 0:
        example->theorem = formula_binary(arena, FORM_IMPLIES, p, p);
        example->proof = imp_intro(arena, p, hypothesis(arena, 0));
        break;
    case 1:
        target = formula_binary(arena, FORM_IMPLIES, q, p);
        example->theorem = formula_binary(arena, FORM_IMPLIES, p, target);
        example->proof = imp_intro(
            arena, p, imp_intro(arena, q, hypothesis(arena, 1)));
        break;
    case 2:
        source = formula_binary(
            arena, FORM_AND, p,
            formula_binary(arena, FORM_IMPLIES, p, q));
        example->theorem = formula_binary(arena, FORM_IMPLIES, source, q);
        example->proof = imp_intro(
            arena, source,
            imp_elim(arena, and_right(arena, hypothesis(arena, 0)),
                     and_left(arena, hypothesis(arena, 0))));
        break;
    case 3:
        source = formula_binary(arena, FORM_AND, p, q);
        target = formula_binary(arena, FORM_AND, q, p);
        example->theorem = formula_binary(arena, FORM_IMPLIES, source, target);
        example->proof = imp_intro(
            arena, source,
            and_intro(arena, and_right(arena, hypothesis(arena, 0)),
                      and_left(arena, hypothesis(arena, 0))));
        break;
    case 4:
        target = generate_true_atom(arena, rng, depth);
        example->theorem = target;
        example->proof = validate(arena, target);
        break;
    case 5:
        target = generate_true_atom(arena, rng, depth);
        example->theorem = formula_binary(arena, FORM_IMPLIES, p, target);
        example->proof = imp_intro(arena, p, validate(arena, target));
        break;
    case 6: {
        Formula *pq = formula_binary(arena, FORM_IMPLIES, p, q);
        Formula *qr = formula_binary(arena, FORM_IMPLIES, q, r);
        target = formula_binary(arena, FORM_IMPLIES, p, r);
        target = formula_binary(arena, FORM_IMPLIES, qr, target);
        example->theorem = formula_binary(arena, FORM_IMPLIES, pq, target);
        example->proof = imp_intro(
            arena, pq,
            imp_intro(
                arena, qr,
                imp_intro(arena, p,
                          imp_elim(arena, hypothesis(arena, 1),
                                   imp_elim(arena, hypothesis(arena, 2),
                                            hypothesis(arena, 0))))));
        break;
    }
    case 7:
        source = formula_binary(
            arena, FORM_AND, formula_binary(arena, FORM_AND, p, q), r);
        target = formula_binary(
            arena, FORM_AND, p, formula_binary(arena, FORM_AND, q, r));
        example->theorem = formula_binary(arena, FORM_IMPLIES, source, target);
        example->proof = imp_intro(
            arena, source,
            and_intro(
                arena, and_left(arena, and_left(arena, hypothesis(arena, 0))),
                and_intro(
                    arena,
                    and_right(arena, and_left(arena, hypothesis(arena, 0))),
                    and_right(arena, hypothesis(arena, 0)))));
        break;
    case 8:
        source = formula_binary(
            arena, FORM_AND, p, formula_binary(arena, FORM_AND, q, r));
        example->theorem = formula_binary(arena, FORM_IMPLIES, source, r);
        example->proof = imp_intro(
            arena, source,
            and_right(arena, and_right(arena, hypothesis(arena, 0))));
        break;
    default:
        target = formula_binary(arena, FORM_AND, p, p);
        example->theorem = formula_binary(arena, FORM_IMPLIES, p, target);
        example->proof = imp_intro(
            arena, p,
            and_intro(arena, hypothesis(arena, 0), hypothesis(arena, 0)));
        break;
    }
    example->task = "prove";
    example->result = "valid";
}

static void choose_task(Arena *arena, Rng *rng, int depth, Example *example)
{
    unsigned choice = rng_bounded(rng, 100);
    if (choice < 55) return;
    example->task = "check";
    if (choice < 80) return;
    example->result = "invalid";
    switch (rng_bounded(rng, 3)) {
    case 0:
        example->proof = validate(arena, generate_false_atom(arena, rng, depth));
        break;
    case 1:
        example->proof = hypothesis(arena, 0);
        break;
    default:
        example->proof = validate(arena, generate_true_atom(arena, rng, depth));
        if (proof_matches(arena, example->theorem, example->proof)) {
            example->proof = hypothesis(arena, 0);
        }
        break;
    }
}

static int serialize_example(const Example *example, char *record,
                             size_t capacity, size_t *length)
{
    Writer writer;
    writer.data = record;
    writer.capacity = capacity;
    writer.length = 0;
    writer.overflow = 0;
    if (capacity != 0) record[0] = '\0';
    writer_text(&writer, "@logic hf1\n@task ");
    writer_text(&writer, example->task);
    writer_text(&writer, "\n@theorem ");
    write_formula(&writer, example->theorem);
    writer_text(&writer, "\n@proof ");
    write_proof(&writer, example->proof);
    writer_text(&writer, "\n@result ");
    writer_text(&writer, example->result);
    writer_text(&writer, "\n@end\n\n");
    *length = writer.length;
    return !writer.overflow;
}

static int parse_and_check(const char *theorem_text, const char *proof_text,
                           int *syntax_ok)
{
    Arena arena;
    Formula *theorem;
    Proof *proof;
    arena_reset(&arena);
    theorem = parse_complete_formula(&arena, theorem_text);
    proof = theorem == NULL ? NULL : parse_complete_proof(&arena, proof_text);
    *syntax_ok = theorem != NULL && proof != NULL;
    return *syntax_ok && proof_matches(&arena, theorem, proof);
}

static void generate_corpus(const char *path, long examples, long seed,
                            int max_depth, int max_chars,
                            int validation_percent)
{
    FILE *file = fopen(path, "wb");
    Rng rng;
    long validation_examples = (examples / 100) * validation_percent +
                               (examples % 100) * validation_percent / 100;
    long training_examples = examples - validation_examples;
    long index;
    long valid_count = 0;
    long invalid_count = 0;
    char record[TEXT_CAPACITY];
    if (file == NULL) fail_path("create", path);
    rng.state = (uint64_t)seed + UINT64_C(1);
    for (index = 0; index < examples; ++index) {
        int attempts;
        int emitted = 0;
        for (attempts = 0; attempts < 100 && !emitted; ++attempts) {
            Arena arena;
            Example example;
            size_t length = 0;
            int expected;
            arena_reset(&arena);
            memset(&example, 0, sizeof(example));
            generate_valid_example(&arena, &rng, max_depth,
                                   index >= training_examples, &example);
            choose_task(&arena, &rng, max_depth, &example);
            expected = strcmp(example.result, "valid") == 0;
            if (proof_matches(&arena, example.theorem, example.proof) != expected) {
                fclose(file);
                fail("internal generator/checker disagreement");
            }
            if (!serialize_example(&example, record, sizeof(record), &length)) {
                fclose(file);
                fail("serialized example exceeded internal buffer");
            }
            if ((int)length <= max_chars) {
                if (fwrite(record, 1, length, file) != length) {
                    fclose(file);
                    fail_path("write", path);
                }
                if (expected) ++valid_count;
                else ++invalid_count;
                emitted = 1;
            }
        }
        if (!emitted) {
            fclose(file);
            fail("could not generate an example within --max-chars");
        }
    }
    if (fclose(file) != 0) fail_path("close", path);
    printf("generated %s: %ld examples (%ld train, %ld structural validation, "
           "%ld valid, %ld invalid), seed=%ld\n",
           path, examples, training_examples, validation_examples, valid_count,
           invalid_count, seed);
}

static void strip_newline(char *line)
{
    size_t length = strlen(line);
    while (length > 0 && (line[length - 1] == '\n' ||
                          line[length - 1] == '\r')) {
        line[--length] = '\0';
    }
}

static void copy_field(char *destination, size_t capacity, const char *source,
                       const char *name, long line_number)
{
    size_t length = strlen(source);
    if (length >= capacity) {
        fprintf(stderr, "error: %s too long at line %ld\n", name, line_number);
        exit(EXIT_FAILURE);
    }
    memcpy(destination, source, length + 1);
}

static void verify_record(const char *task, const char *theorem,
                          const char *proof, const char *result,
                          long record_number, long *valid_count,
                          long *invalid_count)
{
    int syntax_ok;
    int actual;
    int expected;
    if (task[0] == '\0' || theorem[0] == '\0' || proof[0] == '\0' ||
        result[0] == '\0') {
        fprintf(stderr, "error: incomplete record %ld\n", record_number);
        exit(EXIT_FAILURE);
    }
    if (strcmp(task, "prove") != 0 && strcmp(task, "check") != 0) {
        fprintf(stderr, "error: unknown task in record %ld\n", record_number);
        exit(EXIT_FAILURE);
    }
    if (strcmp(result, "valid") == 0) expected = 1;
    else if (strcmp(result, "invalid") == 0) expected = 0;
    else {
        fprintf(stderr, "error: unknown result in record %ld\n", record_number);
        exit(EXIT_FAILURE);
    }
    if (strcmp(task, "prove") == 0 && !expected) {
        fprintf(stderr, "error: prove task marked invalid in record %ld\n",
                record_number);
        exit(EXIT_FAILURE);
    }
    actual = parse_and_check(theorem, proof, &syntax_ok);
    if (!syntax_ok) {
        fprintf(stderr, "error: malformed theorem or proof in record %ld\n",
                record_number);
        exit(EXIT_FAILURE);
    }
    if (actual != expected) {
        fprintf(stderr, "error: checker disagrees with record %ld\n",
                record_number);
        exit(EXIT_FAILURE);
    }
    if (actual) ++*valid_count;
    else ++*invalid_count;
}

static void verify_corpus(const char *path)
{
    FILE *file = fopen(path, "rb");
    char line[TEXT_CAPACITY];
    char task[32] = "";
    char theorem[TEXT_CAPACITY] = "";
    char proof[TEXT_CAPACITY] = "";
    char result[32] = "";
    long line_number = 0;
    long record_count = 0;
    long valid_count = 0;
    long invalid_count = 0;
    int in_record = 0;
    if (file == NULL) fail_path("open", path);
    while (fgets(line, sizeof(line), file) != NULL) {
        ++line_number;
        if (strchr(line, '\n') == NULL && !feof(file)) {
            fclose(file);
            fail("corpus line exceeds verifier buffer");
        }
        strip_newline(line);
        if (line[0] == '\0') continue;
        if (strcmp(line, "@logic hf1") == 0) {
            if (in_record) {
                fclose(file);
                fail("nested corpus record");
            }
            in_record = 1;
            task[0] = theorem[0] = proof[0] = result[0] = '\0';
        } else if (!in_record) {
            fclose(file);
            fail("content outside corpus record");
        } else if (strncmp(line, "@task ", 6) == 0) {
            copy_field(task, sizeof(task), line + 6, "task", line_number);
        } else if (strncmp(line, "@theorem ", 9) == 0) {
            copy_field(theorem, sizeof(theorem), line + 9, "theorem", line_number);
        } else if (strncmp(line, "@proof ", 7) == 0) {
            copy_field(proof, sizeof(proof), line + 7, "proof", line_number);
        } else if (strncmp(line, "@result ", 8) == 0) {
            copy_field(result, sizeof(result), line + 8, "result", line_number);
        } else if (strcmp(line, "@end") == 0) {
            ++record_count;
            verify_record(task, theorem, proof, result, record_count,
                          &valid_count, &invalid_count);
            in_record = 0;
        } else {
            fprintf(stderr, "error: unknown field at line %ld\n", line_number);
            fclose(file);
            exit(EXIT_FAILURE);
        }
    }
    if (ferror(file)) {
        fclose(file);
        fail_path("read", path);
    }
    if (fclose(file) != 0) fail_path("close", path);
    if (in_record) fail("unterminated corpus record");
    if (record_count == 0) fail("corpus contains no records");
    printf("verified %s: %ld records (%ld valid, %ld invalid)\n", path,
           record_count, valid_count, invalid_count);
}

static void self_test(void)
{
    Rng rng;
    int index;
    int saw_valid = 0;
    int saw_invalid = 0;
    rng.state = UINT64_C(1234567);
    for (index = 0; index < 1000; ++index) {
        Arena arena;
        Arena parsed;
        Example example;
        char record[TEXT_CAPACITY];
        char theorem[TEXT_CAPACITY];
        char proof[TEXT_CAPACITY];
        Writer writer;
        size_t record_length;
        int syntax_ok;
        int expected;
        arena_reset(&arena);
        memset(&example, 0, sizeof(example));
        generate_valid_example(&arena, &rng, 3, index >= 900, &example);
        choose_task(&arena, &rng, 3, &example);
        expected = strcmp(example.result, "valid") == 0;
        if (proof_matches(&arena, example.theorem, example.proof) != expected) {
            fail("self-test generator/checker disagreement");
        }
        if (!serialize_example(&example, record, sizeof(record), &record_length) ||
            record_length == 0) {
            fail("self-test record serialization failed");
        }
        arena_reset(&parsed);
        writer.data = theorem;
        writer.capacity = sizeof(theorem);
        writer.length = 0;
        writer.overflow = 0;
        theorem[0] = '\0';
        write_formula(&writer, example.theorem);
        writer.data = proof;
        writer.capacity = sizeof(proof);
        writer.length = 0;
        writer.overflow = 0;
        proof[0] = '\0';
        write_proof(&writer, example.proof);
        if (parse_and_check(theorem, proof, &syntax_ok) != expected || !syntax_ok) {
            fail("self-test parser/checker disagreement");
        }
        (void)parsed;
        saw_valid |= expected;
        saw_invalid |= !expected;
    }
    if (!saw_valid || !saw_invalid) fail("self-test did not cover both labels");
    printf("logic_corpus self-test passed (1000 generated and checked proofs)\n");
}

static void usage(const char *program)
{
    printf("usage:\n"
           "  %s --output FILE [--examples N] [--seed N] [--max-depth N]\n"
           "     [--max-chars N] [--validation-percent N]\n"
           "  %s --verify FILE\n"
           "  %s --check-theorem FORMULA --proof PROOF\n"
           "  %s --self-test\n\n"
           "defaults: --examples 10000 --seed 1 --max-depth 3 "
           "--max-chars 480 --validation-percent 5\n",
           program, program, program, program);
}

int main(int argc, char **argv)
{
    const char *output_path = NULL;
    const char *verify_path = NULL;
    const char *check_theorem = NULL;
    const char *check_proof = NULL;
    long examples = 10000;
    long seed = 1;
    int max_depth = 3;
    int max_chars = 480;
    int validation_percent = 5;
    int run_self_test = 0;
    int i;
    for (i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--help") == 0) {
            usage(argv[0]);
            return EXIT_SUCCESS;
        } else if (strcmp(argv[i], "--output") == 0 && i + 1 < argc) {
            output_path = argv[++i];
        } else if (strcmp(argv[i], "--verify") == 0 && i + 1 < argc) {
            verify_path = argv[++i];
        } else if (strcmp(argv[i], "--check-theorem") == 0 && i + 1 < argc) {
            check_theorem = argv[++i];
        } else if (strcmp(argv[i], "--proof") == 0 && i + 1 < argc) {
            check_proof = argv[++i];
        } else if (strcmp(argv[i], "--examples") == 0 && i + 1 < argc) {
            examples = parse_long(argv[++i], "--examples");
        } else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            seed = parse_long(argv[++i], "--seed");
        } else if (strcmp(argv[i], "--max-depth") == 0 && i + 1 < argc) {
            max_depth = parse_int(argv[++i], "--max-depth");
        } else if (strcmp(argv[i], "--max-chars") == 0 && i + 1 < argc) {
            max_chars = parse_int(argv[++i], "--max-chars");
        } else if (strcmp(argv[i], "--validation-percent") == 0 &&
                   i + 1 < argc) {
            validation_percent = parse_int(argv[++i], "--validation-percent");
        } else if (strcmp(argv[i], "--self-test") == 0) {
            run_self_test = 1;
        } else {
            usage(argv[0]);
            fail("unknown or incomplete option");
        }
    }
    if ((check_theorem == NULL) != (check_proof == NULL)) {
        fail("--check-theorem and --proof must be used together");
    }
    if ((output_path != NULL) + (verify_path != NULL) +
            (check_theorem != NULL) + run_self_test != 1) {
        usage(argv[0]);
        fail("choose exactly one generator, verifier, proof check, or self-test mode");
    }
    if (examples < 1 || max_depth < 0 || max_depth > 6 || max_chars < 128 ||
        max_chars >= TEXT_CAPACITY || validation_percent < 0 ||
        validation_percent > 50) {
        fail("options out of range");
    }
    if (run_self_test) self_test();
    else if (verify_path != NULL) verify_corpus(verify_path);
    else if (check_theorem != NULL) {
        int syntax_ok;
        int valid = parse_and_check(check_theorem, check_proof, &syntax_ok);
        if (!syntax_ok) fail("malformed theorem or proof");
        printf("%s\n", valid ? "valid" : "invalid");
    }
    else generate_corpus(output_path, examples, seed, max_depth, max_chars,
                         validation_percent);
    return EXIT_SUCCESS;
}
