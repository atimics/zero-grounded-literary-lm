#ifndef LITERARY_INFER_H
#define LITERARY_INFER_H

#include <stdint.h>

enum {
    LM_HOLO_DISABLED = 0,
    LM_HOLO_FLAT = 1,
    LM_HOLO_PARTITIONED = 2
};

int lm_load(const unsigned char *data, int length);
void lm_reset(void);
void lm_seed(uint32_t seed);
int lm_feed(int token);
int lm_sample(float temperature, int top_k, float repetition_penalty);
float lm_probability(int token);
int lm_get_context(void);
int lm_get_position(void);
int lm_get_update(void);
int lm_get_parameters(void);

void lm_holo_reset(void);
int lm_holo_set_mode(int mode);
int lm_holo_get_mode(void);
int lm_holo_remember(const unsigned char *text, int length);
int lm_holo_recall(const unsigned char *text, int length);
float lm_holo_get_score(void);
int lm_holo_get_count(void);

#endif
