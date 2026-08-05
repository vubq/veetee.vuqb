#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define VT_PAIRING_CODE_LENGTH 6U

bool vt_pairing_code_is_valid(const char *code);
bool vt_pairing_code_from_entropy(uint32_t entropy, char code[VT_PAIRING_CODE_LENGTH + 1U]);

