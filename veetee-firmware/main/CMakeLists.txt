idf_component_register(
    SRCS "main.c" "veetee_protocol.c" "veetee_state.c" "veetee_config.c"
    INCLUDE_DIRS "."
    REQUIRES freertos log
)
