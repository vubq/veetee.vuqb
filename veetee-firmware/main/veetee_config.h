#pragma once

#include <stdbool.h>
#include <stddef.h>

typedef struct {
    const char *profile_id;
    const char *endpoint;
    const char *device_id;
    const char *client_id;
    int protocol_version;
    int uplink_sample_rate;
    int downlink_sample_rate;
    int frame_duration_ms;
    bool verified_hardware;
} vt_runtime_config_t;

bool vt_config_is_flash_safe(const vt_runtime_config_t *config);
