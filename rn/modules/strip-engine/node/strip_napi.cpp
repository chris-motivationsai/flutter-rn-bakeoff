// Node (N-API) binding used by the headless tests and the scenario runner on this Mac.
// It is the counterpart of ios/StripEngineModule.swift and android/.../strip_jni.cpp:
// same two bridge calls, same JS shape ({ status, ratio } and a version string).
#include <node_api.h>
#include "../cpp/strip_bridge.h"

static napi_value Read(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  bool is_typed = false;
  if (argc < 3 || napi_is_typedarray(env, argv[0], &is_typed) != napi_ok || !is_typed) {
    napi_throw_type_error(env, nullptr, "read(gray: Uint8Array, width: number, height: number)");
    return nullptr;
  }
  napi_typedarray_type type; size_t length = 0; void* data = nullptr; napi_value buffer; size_t offset = 0;
  napi_get_typedarray_info(env, argv[0], &type, &length, &data, &buffer, &offset);
  if (type != napi_uint8_array) {
    napi_throw_type_error(env, nullptr, "gray must be a Uint8Array");
    return nullptr;
  }
  int32_t width = 0, height = 0;
  napi_get_value_int32(env, argv[1], &width);
  napi_get_value_int32(env, argv[2], &height);

  double ratio = 0.0;
  int32_t status = strip_bridge_read(static_cast<const uint8_t*>(data), length, width, height, &ratio);

  napi_value result, js_status, js_ratio;
  napi_create_object(env, &result);
  napi_create_int32(env, status, &js_status);
  napi_create_double(env, ratio, &js_ratio);
  napi_set_named_property(env, result, "status", js_status);
  napi_set_named_property(env, result, "ratio", js_ratio);
  return result;
}

static napi_value Version(napi_env env, napi_callback_info) {
  napi_value out;
  napi_create_string_utf8(env, strip_bridge_version(), NAPI_AUTO_LENGTH, &out);
  return out;
}

NAPI_MODULE_INIT() {
  napi_value read, version;
  napi_create_function(env, "read", NAPI_AUTO_LENGTH, Read, nullptr, &read);
  napi_create_function(env, "version", NAPI_AUTO_LENGTH, Version, nullptr, &version);
  napi_set_named_property(env, exports, "read", read);
  napi_set_named_property(env, exports, "version", version);
  return exports;
}
