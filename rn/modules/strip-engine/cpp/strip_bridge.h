// The one piece of glue every runtime shares. iOS (Swift), Android (JNI) and the Node test addon (N-API)
// all call these two functions and nothing else, so the kit engine is always entered the same way.
#ifndef STRIP_BRIDGE_H
#define STRIP_BRIDGE_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

// Runs strip_read on `length` gray bytes. Returns the engine status (0..4) and writes the ratio.
// Returns STRIP_BAD_INPUT (4) without calling the engine when length != width * height,
// because the engine trusts the caller about the buffer size.
int32_t strip_bridge_read(const uint8_t* gray, size_t length, int32_t width, int32_t height, double* ratio_out);

// strip_engine_version(), unchanged.
const char* strip_bridge_version(void);

#ifdef __cplusplus
}
#endif
#endif
