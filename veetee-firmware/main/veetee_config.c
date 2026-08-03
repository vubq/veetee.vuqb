#include "veetee_config.h"

#include <string.h>

bool vt_config_is_flash_safe(const vt_runtime_config_t *config) {
    if (config == NULL || !config->verified_hardware || config->profile_id == NULL ||
        config->endpoint == NULL || config->device_id == NULL || config->client_id == NULL) {
        return false;
    }
    if (config->protocol_version < 1 || config->protocol_version > 3 ||
        config->uplink_sample_rate <= 0 || config->downlink_sample_rate <= 0 ||
        config->frame_duration_ms <= 0) {
        return false;
    }
    return strlen(config->profile_id) > 0U && strlen(config->endpoint) > 0U;
}
