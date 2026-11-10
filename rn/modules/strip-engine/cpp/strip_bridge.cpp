#include "strip_bridge.h"
#include "engine/strip_engine.h"

extern "C" int32_t strip_bridge_read(const uint8_t* gray, size_t length, int32_t width, int32_t height, double* ratio_out) {
  if (ratio_out) *ratio_out = 0.0;
  if (!gray || width <= 0 || height <= 0) return STRIP_BAD_INPUT;
  if (length != static_cast<size_t>(width) * static_cast<size_t>(height)) return STRIP_BAD_INPUT;
  StripResult result;
  int32_t status = strip_read(gray, width, height, &result);
  if (ratio_out && status == STRIP_OK) *ratio_out = result.ratio;
  return status;
}

extern "C" const char* strip_bridge_version(void) { return strip_engine_version(); }
