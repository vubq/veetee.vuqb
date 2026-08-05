#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

#include "veetee_mcp.h"
#include "veetee_mcp_dispatch.h"
#include "veetee_board_hal.h"

#define VT_MCP_TASK_MAX_SESSION_BYTES 96U
#define VT_MCP_TASK_MAX_MESSAGE_BYTES VT_MCP_WIRE_MAX_BYTES

typedef enum {
    VT_MCP_TASK_OK = 0,
    VT_MCP_TASK_ERR_ARGUMENT = -1,
    VT_MCP_TASK_ERR_CAPACITY = -2,
    VT_MCP_TASK_ERR_QUEUE = -3,
    VT_MCP_TASK_ERR_SESSION = -4,
} vt_mcp_task_result_t;

typedef int (*vt_mcp_task_send_fn)(
    const char *text,
    const char *session_id,
    void *context);

typedef const char *(*vt_mcp_task_current_session_fn)(void *context);

typedef struct {
    uint16_t length;
    char session_id[VT_MCP_TASK_MAX_SESSION_BYTES];
    char json[VT_MCP_TASK_MAX_MESSAGE_BYTES + 1U];
} vt_mcp_task_request_t;

typedef struct {
    QueueHandle_t queue;
    SemaphoreHandle_t registry_lock;
    vt_mcp_registry_t registry;
    /* Caller-owned copy of enabled BoardHal descriptors. Keeping storage in the
     * task makes the registry lifetime independent from a parsed manifest. */
    vt_mcp_tool_t tool_storage[VT_MCP_MAX_TOOLS];
    char *output;
    const char *server_name;
    const char *server_version;
    vt_mcp_task_send_fn send;
    vt_mcp_task_current_session_fn current_session;
    void *context;
    volatile bool stop_requested;
} vt_mcp_task_t;

vt_mcp_task_result_t vt_mcp_task_init(
    vt_mcp_task_t *task,
    const vt_mcp_tool_t *tools,
    size_t tool_count,
    const char *server_name,
    const char *server_version,
    vt_mcp_task_send_fn send,
    vt_mcp_task_current_session_fn current_session,
    void *context,
    UBaseType_t queue_depth);

vt_mcp_task_result_t vt_mcp_task_init_from_board_hal(
    vt_mcp_task_t *task,
    const vt_board_hal_t *hal,
    const char *server_name,
    const char *server_version,
    vt_mcp_task_send_fn send,
    vt_mcp_task_current_session_fn current_session,
    void *context,
    UBaseType_t queue_depth);

void vt_mcp_task_reset_session(vt_mcp_task_t *task);

vt_mcp_task_result_t vt_mcp_task_enqueue(
    vt_mcp_task_t *task,
    const cJSON *message,
    const char *session_id);

void vt_mcp_task_run(void *context);
