#include "veetee_mcp_task.h"

#include <string.h>

#include "esp_log.h"
#include "freertos/task.h"

static const char *TAG = "veetee-mcp";

static vt_mcp_task_result_t init_common(
    vt_mcp_task_t *task,
    const vt_mcp_tool_t *tools,
    size_t tool_count,
    const char *server_name,
    const char *server_version,
    vt_mcp_task_send_fn send,
    vt_mcp_task_current_session_fn current_session,
    void *context,
    UBaseType_t queue_depth) {
    if (task == NULL || server_name == NULL || server_version == NULL ||
        send == NULL || current_session == NULL || queue_depth == 0U) {
        return VT_MCP_TASK_ERR_ARGUMENT;
    }
    if (vt_mcp_registry_init(&task->registry, tools, tool_count) != VT_MCP_OK) {
        return VT_MCP_TASK_ERR_ARGUMENT;
    }
    task->queue = xQueueCreate(queue_depth, sizeof(vt_mcp_task_request_t));
    if (task->queue == NULL) return VT_MCP_TASK_ERR_QUEUE;
    task->registry_lock = xSemaphoreCreateMutex();
    if (task->registry_lock == NULL) {
        vQueueDelete(task->queue);
        task->queue = NULL;
        return VT_MCP_TASK_ERR_QUEUE;
    }
    task->server_name = server_name;
    task->server_version = server_version;
    task->send = send;
    task->current_session = current_session;
    task->context = context;
    return VT_MCP_TASK_OK;
}

static bool copy_session(char *destination, size_t capacity, const char *session_id) {
    if (destination == NULL || capacity == 0U || session_id == NULL) return false;
    const size_t length = strlen(session_id);
    if (length >= capacity) return false;
    memcpy(destination, session_id, length + 1U);
    return true;
}

vt_mcp_task_result_t vt_mcp_task_init(
    vt_mcp_task_t *task,
    const vt_mcp_tool_t *tools,
    size_t tool_count,
    const char *server_name,
    const char *server_version,
    vt_mcp_task_send_fn send,
    vt_mcp_task_current_session_fn current_session,
    void *context,
    UBaseType_t queue_depth) {
    if (task == NULL) return VT_MCP_TASK_ERR_ARGUMENT;
    memset(task, 0, sizeof(*task));
    return init_common(task, tools, tool_count, server_name, server_version, send,
                       current_session, context, queue_depth);
}

vt_mcp_task_result_t vt_mcp_task_init_from_board_hal(
    vt_mcp_task_t *task,
    const vt_board_hal_t *hal,
    const char *server_name,
    const char *server_version,
    vt_mcp_task_send_fn send,
    vt_mcp_task_current_session_fn current_session,
    void *context,
    UBaseType_t queue_depth) {
    if (task == NULL || hal == NULL) return VT_MCP_TASK_ERR_ARGUMENT;
    memset(task, 0, sizeof(*task));
    size_t tool_count = 0U;
    if (vt_board_hal_copy_tools(hal, task->tool_storage, VT_MCP_MAX_TOOLS, &tool_count) != VT_BOARD_HAL_OK) {
        return VT_MCP_TASK_ERR_CAPACITY;
    }
    return init_common(task, task->tool_storage, tool_count, server_name, server_version,
                       send, current_session, context, queue_depth);
}

void vt_mcp_task_reset_session(vt_mcp_task_t *task) {
    if (task == NULL) return;
    if (task->registry_lock != NULL && xSemaphoreTake(task->registry_lock, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "MCP session reset skipped: registry lock timeout");
        return;
    }
    vt_mcp_registry_reset_session(&task->registry);
    if (task->registry_lock != NULL) (void)xSemaphoreGive(task->registry_lock);
    if (task->queue != NULL) (void)xQueueReset(task->queue);
}

vt_mcp_task_result_t vt_mcp_task_enqueue(
    vt_mcp_task_t *task,
    const cJSON *message,
    const char *session_id) {
    if (task == NULL || task->queue == NULL || message == NULL || session_id == NULL) {
        return VT_MCP_TASK_ERR_ARGUMENT;
    }
    vt_mcp_task_request_t request = {0};
    if (!copy_session(request.session_id, sizeof(request.session_id), session_id)) {
        return VT_MCP_TASK_ERR_SESSION;
    }
    char *serialized = cJSON_PrintUnformatted(message);
    if (serialized == NULL) return VT_MCP_TASK_ERR_CAPACITY;
    const size_t length = strlen(serialized);
    if (length == 0U || length > VT_MCP_TASK_MAX_MESSAGE_BYTES) {
        cJSON_free(serialized);
        return VT_MCP_TASK_ERR_CAPACITY;
    }
    memcpy(request.json, serialized, length + 1U);
    request.length = (uint16_t)length;
    cJSON_free(serialized);
    if (xQueueSend(task->queue, &request, 0) != pdTRUE) return VT_MCP_TASK_ERR_QUEUE;
    return VT_MCP_TASK_OK;
}

static bool session_is_current(const vt_mcp_task_t *task, const char *session_id) {
    if (task == NULL || task->current_session == NULL || session_id == NULL) return false;
    const char *current = task->current_session(task->context);
    if (current == NULL) return false;
    /* An empty session is the explicit compatibility case for a peer that sent
       MCP before hello. It is never allowed to match a non-empty stale id. */
    return session_id[0] == '\0' || strcmp(current, session_id) == 0;
}

void vt_mcp_task_run(void *context) {
    vt_mcp_task_t *task = (vt_mcp_task_t *)context;
    if (task == NULL || task->queue == NULL) {
        vTaskDelete(NULL);
        return;
    }
    static char output[VT_MCP_WIRE_MAX_BYTES + 1U];
    vt_mcp_task_request_t request = {0};
    while (!task->stop_requested) {
        if (xQueueReceive(task->queue, &request, pdMS_TO_TICKS(100)) != pdTRUE) continue;
        if (!session_is_current(task, request.session_id)) continue;
        cJSON *message = cJSON_ParseWithLength(request.json, request.length);
        if (message == NULL) continue;
        size_t output_length = 0U;
        vt_mcp_dispatch_result_t dispatch = VT_MCP_DISPATCH_ERR_ARGUMENT;
        if (task->registry_lock != NULL && xSemaphoreTake(task->registry_lock, pdMS_TO_TICKS(100)) == pdTRUE) {
            dispatch = vt_mcp_dispatch_message(
                message, request.session_id, task->server_name, task->server_version,
                &task->registry, output, sizeof(output), &output_length);
            (void)xSemaphoreGive(task->registry_lock);
        }
        cJSON_Delete(message);
        if (dispatch == VT_MCP_DISPATCH_IGNORED || dispatch != VT_MCP_DISPATCH_OK ||
            output_length == 0U || !session_is_current(task, request.session_id)) {
            if (dispatch != VT_MCP_DISPATCH_IGNORED && dispatch != VT_MCP_DISPATCH_OK) {
                ESP_LOGW(TAG, "MCP request dropped dispatch=%d", (int)dispatch);
            }
            continue;
        }
        if (task->send(output, request.session_id, task->context) != 0) {
            ESP_LOGW(TAG, "MCP response send failed");
        }
    }
    vTaskDelete(NULL);
}
