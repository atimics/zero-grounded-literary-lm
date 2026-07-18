#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "quantity_oracle.h"

#define QUANTITY_BOUND 1000000000LL

static int bounded(long long value)
{
    return value >= -QUANTITY_BOUND && value <= QUANTITY_BOUND;
}

static int write_checked(char *output, size_t capacity, const char *format,
                         long long a, long long b, long long c)
{
    int written = snprintf(output, capacity, format, a, b, c);
    return written >= 0 && (size_t)written < capacity;
}

static long long gcd_positive(long long a, long long b)
{
    if (a < 0) a = -a;
    if (b < 0) b = -b;
    while (b != 0) {
        long long remainder = a % b;
        a = b;
        b = remainder;
    }
    return a == 0 ? 1 : a;
}

static int finish_summary(const char *artifact, char *summary,
                          size_t capacity)
{
    int written = snprintf(summary, capacity, "kernel committed %s", artifact);
    return written >= 0 && (size_t)written < capacity;
}

int quantity_request_from_input(const char *input, char *request,
                                size_t capacity)
{
    long long a, b, c, d;
    int consumed = 0;
    char conversion[24];
    if (input == NULL || request == NULL || capacity == 0) return 0;
    if (sscanf(input, "add %lld %lld%n", &a, &b, &consumed) == 2 &&
        input[consumed] == '\0' && bounded(a) && bounded(b)) {
        return write_checked(request, capacity, "quantity.add %lld %lld", a,
                             b, 0);
    }
    consumed = 0;
    if (sscanf(input, "multiply %lld %lld%n", &a, &b, &consumed) == 2 &&
        input[consumed] == '\0' && bounded(a) && bounded(b)) {
        return write_checked(request, capacity, "quantity.multiply %lld %lld",
                             a, b, 0);
    }
    consumed = 0;
    if (sscanf(input, "add-rational %lld/%lld %lld/%lld%n", &a, &b, &c,
               &d, &consumed) == 4 && input[consumed] == '\0' && b != 0 &&
        d != 0 && bounded(a) && bounded(b) && bounded(c) && bounded(d)) {
        int written = snprintf(request, capacity,
                               "quantity.add-rational %lld/%lld %lld/%lld", a,
                               b, c, d);
        return written >= 0 && (size_t)written < capacity;
    }
    consumed = 0;
    if (sscanf(input, "convert %lld %23s%n", &a, conversion, &consumed) == 2 &&
        input[consumed] == '\0' && bounded(a) &&
        (strcmp(conversion, "m-to-cm") == 0 ||
         strcmp(conversion, "cm-to-mm") == 0 ||
         strcmp(conversion, "kg-to-g") == 0)) {
        int written = snprintf(request, capacity, "quantity.convert %lld %s",
                               a, conversion);
        return written >= 0 && (size_t)written < capacity;
    }
    consumed = 0;
    if (sscanf(input, "solve %lld*x+%lld=%lld%n", &a, &b, &c, &consumed) ==
            3 &&
        input[consumed] == '\0' && a != 0 && bounded(a) && bounded(b) &&
        bounded(c)) {
        return write_checked(request, capacity,
                             "quantity.solve-linear %lld %lld %lld", a, b,
                             c);
    }
    return 0;
}

int quantity_oracle_execute(const char *request, char *artifact,
                            size_t artifact_capacity, char *summary,
                            size_t summary_capacity)
{
    long long a, b, c, d;
    long long result;
    int consumed = 0;
    char conversion[24];
    if (request == NULL || artifact == NULL || summary == NULL ||
        artifact_capacity == 0 || summary_capacity == 0) {
        return 0;
    }
    if (sscanf(request, "quantity.add %lld %lld%n", &a, &b, &consumed) == 2 &&
        request[consumed] == '\0' && bounded(a) && bounded(b)) {
        result = a + b;
        if (!write_checked(artifact, artifact_capacity, "result %lld", result,
                           0, 0)) return 0;
        return finish_summary(artifact, summary, summary_capacity);
    }
    consumed = 0;
    if (sscanf(request, "quantity.multiply %lld %lld%n", &a, &b,
               &consumed) == 2 && request[consumed] == '\0' && bounded(a) &&
        bounded(b)) {
        result = a * b;
        if (!write_checked(artifact, artifact_capacity, "result %lld", result,
                           0, 0)) return 0;
        return finish_summary(artifact, summary, summary_capacity);
    }
    consumed = 0;
    if (sscanf(request, "quantity.add-rational %lld/%lld %lld/%lld%n", &a,
               &b, &c, &d, &consumed) == 4 && request[consumed] == '\0' &&
        b != 0 && d != 0 && bounded(a) && bounded(b) && bounded(c) &&
        bounded(d)) {
        long long numerator = a * d + c * b;
        long long denominator = b * d;
        long long divisor;
        if (denominator < 0) {
            numerator = -numerator;
            denominator = -denominator;
        }
        divisor = gcd_positive(numerator, denominator);
        numerator /= divisor;
        denominator /= divisor;
        if (denominator == 1) {
            if (!write_checked(artifact, artifact_capacity, "result %lld",
                               numerator, 0, 0)) return 0;
        } else {
            if (!write_checked(artifact, artifact_capacity,
                               "result %lld/%lld", numerator, denominator,
                               0)) return 0;
        }
        return finish_summary(artifact, summary, summary_capacity);
    }
    consumed = 0;
    if (sscanf(request, "quantity.convert %lld %23s%n", &a, conversion,
               &consumed) == 2 && request[consumed] == '\0' && bounded(a)) {
        long long factor;
        const char *unit;
        int written;
        if (strcmp(conversion, "m-to-cm") == 0) {
            factor = 100;
            unit = "cm";
        } else if (strcmp(conversion, "cm-to-mm") == 0) {
            factor = 10;
            unit = "mm";
        } else if (strcmp(conversion, "kg-to-g") == 0) {
            factor = 1000;
            unit = "g";
        } else {
            return 0;
        }
        result = a * factor;
        written = snprintf(artifact, artifact_capacity, "result %lld %s",
                           result, unit);
        if (written < 0 || (size_t)written >= artifact_capacity) return 0;
        return finish_summary(artifact, summary, summary_capacity);
    }
    consumed = 0;
    if (sscanf(request, "quantity.solve-linear %lld %lld %lld%n", &a, &b,
               &c, &consumed) == 3 && request[consumed] == '\0' && a != 0 &&
        bounded(a) && bounded(b) && bounded(c) && (c - b) % a == 0) {
        result = (c - b) / a;
        if (!write_checked(artifact, artifact_capacity, "x %lld", result, 0,
                           0)) return 0;
        return finish_summary(artifact, summary, summary_capacity);
    }
    return 0;
}
