cmake_minimum_required(VERSION 3.16)
project(veetee_firmware_host_tests C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
find_package(OpenSSL REQUIRED)
add_executable(veetee_firmware_host_tests test_protocol_state.c ../main/veetee_protocol.c ../main/veetee_state.c ../main/veetee_config.c ../main/veetee_wake.c ../main/veetee_wire_guard.c ../main/veetee_ptt.c ../main/veetee_pairing.c)
target_include_directories(veetee_firmware_host_tests PRIVATE ../main)
set(VT_WIRE_GOLDEN_FIXTURE_PATH "${CMAKE_CURRENT_LIST_DIR}/../../tests/fixtures/ws_audio_golden.csv")
target_compile_definitions(veetee_firmware_host_tests PRIVATE VT_WIRE_GOLDEN_FIXTURE_PATH="${VT_WIRE_GOLDEN_FIXTURE_PATH}")
target_compile_options(veetee_firmware_host_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
enable_testing()
add_test(NAME protocol_state COMMAND veetee_firmware_host_tests)

add_executable(veetee_firmware_mqtt_udp_wire_tests test_mqtt_udp_wire.c ../main/veetee_mqtt_udp_wire.c)
target_include_directories(veetee_firmware_mqtt_udp_wire_tests PRIVATE ../main)
target_compile_options(veetee_firmware_mqtt_udp_wire_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
add_test(NAME mqtt_udp_wire COMMAND veetee_firmware_mqtt_udp_wire_tests)

add_executable(veetee_firmware_mqtt_udp_crypto_tests test_mqtt_udp_crypto.c ../main/veetee_mqtt_udp_wire.c ../main/veetee_mqtt_udp_crypto.c)
target_include_directories(veetee_firmware_mqtt_udp_crypto_tests PRIVATE ../main)
target_compile_options(veetee_firmware_mqtt_udp_crypto_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
target_link_libraries(veetee_firmware_mqtt_udp_crypto_tests PRIVATE OpenSSL::Crypto)
add_test(NAME mqtt_udp_crypto COMMAND veetee_firmware_mqtt_udp_crypto_tests)

add_executable(veetee_firmware_mcp_registry_tests test_mcp_registry.c ../main/veetee_mcp.c)
target_include_directories(veetee_firmware_mcp_registry_tests PRIVATE ../main)
target_compile_options(veetee_firmware_mcp_registry_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
add_test(NAME mcp_registry COMMAND veetee_firmware_mcp_registry_tests)

add_executable(veetee_firmware_mcp_wire_tests test_mcp_wire.c ../main/veetee_mcp.c ../main/veetee_mcp_wire.c)
target_include_directories(veetee_firmware_mcp_wire_tests PRIVATE ../main)
target_compile_options(veetee_firmware_mcp_wire_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
add_test(NAME mcp_wire COMMAND veetee_firmware_mcp_wire_tests)

set(VT_CJSON_ROOT "${CMAKE_CURRENT_LIST_DIR}/../managed_components/espressif__cjson/cJSON")
if(EXISTS "${VT_CJSON_ROOT}/cJSON.c" AND EXISTS "${VT_CJSON_ROOT}/cJSON.h")
    add_executable(veetee_firmware_mcp_dispatch_tests
        test_mcp_dispatch.c
        ../main/veetee_mcp.c
        ../main/veetee_mcp_wire.c
        ../main/veetee_mcp_dispatch.c
        "${VT_CJSON_ROOT}/cJSON.c")
    target_include_directories(veetee_firmware_mcp_dispatch_tests PRIVATE ../main "${VT_CJSON_ROOT}")
    target_compile_options(veetee_firmware_mcp_dispatch_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
    add_test(NAME mcp_dispatch COMMAND veetee_firmware_mcp_dispatch_tests)

    set(VT_MCP_CONFORMANCE_FIXTURE_PATH "${CMAKE_CURRENT_LIST_DIR}/../../tests/fixtures/mcp_conformance.json")
    add_executable(veetee_firmware_mcp_conformance_tests
        test_mcp_conformance.c
        ../main/veetee_mcp.c
        ../main/veetee_mcp_wire.c
        ../main/veetee_mcp_dispatch.c
        "${VT_CJSON_ROOT}/cJSON.c")
    target_include_directories(veetee_firmware_mcp_conformance_tests PRIVATE ../main "${VT_CJSON_ROOT}")
    target_compile_definitions(veetee_firmware_mcp_conformance_tests PRIVATE
        VT_MCP_CONFORMANCE_FIXTURE_PATH="${VT_MCP_CONFORMANCE_FIXTURE_PATH}")
    target_compile_options(veetee_firmware_mcp_conformance_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
    add_test(NAME mcp_conformance COMMAND veetee_firmware_mcp_conformance_tests)
else()
    message(STATUS "Skipping mcp_dispatch host test: ESP-IDF cJSON source is not resolved")
endif()

add_executable(veetee_firmware_board_hal_tests
    test_board_hal.c
    ../main/veetee_board_hal.c
    ../main/veetee_mcp.c)
target_include_directories(veetee_firmware_board_hal_tests PRIVATE ../main)
target_compile_options(veetee_firmware_board_hal_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
add_test(NAME board_hal COMMAND veetee_firmware_board_hal_tests)

add_executable(veetee_firmware_aec_reference_tests
    test_aec_reference.c
    ../main/veetee_aec_reference.c)
target_include_directories(veetee_firmware_aec_reference_tests PRIVATE ../main)
target_compile_options(veetee_firmware_aec_reference_tests PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic)
add_test(NAME aec_reference COMMAND veetee_firmware_aec_reference_tests)
