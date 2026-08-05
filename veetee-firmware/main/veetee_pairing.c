#include "veetee_pairing.h"

#include <stdio.h>

bool vt_pairing_code_is_valid(const char *code) {
    if (code == NULL) return false;
    for (size_t index = 0; index < VT_PAIRING_CODE_LENGTH; ++index) {
        if (code[index] == '\0') return false;
        if (code[index] < '0' || code[index] > '9') return false;
    }
    return code[VT_PAIRING_CODE_LENGTH] == '\0';
}

bool vt_pairing_code_from_entropy(uint32_t entropy, char code[VT_PAIRING_CODE_LENGTH + 1U]) {
    if (code == NULL) return false;
    const uint32_t value = 100000U + (entropy % 900000U);
    const int written = snprintf(code, VT_PAIRING_CODE_LENGTH + 1U, "%06lu", (unsigned long)value);
    return written == (int)VT_PAIRING_CODE_LENGTH;
}
