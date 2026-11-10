// Bakeoff strip engine. C ABI so any runtime can bind to it. Do not modify.
#ifndef STRIP_ENGINE_H
#define STRIP_ENGINE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

// status codes
#define STRIP_OK 0
#define STRIP_NO_CONTROL_LINE 1
#define STRIP_TOO_DARK 2
#define STRIP_TOO_BRIGHT 3
#define STRIP_BAD_INPUT 4

typedef struct {
  int32_t status;          // one of the codes above
  double ratio;            // test line / control line (valid only when status == STRIP_OK)
  double control_intensity;
  double test_intensity;
} StripResult;

// gray: width*height bytes, row-major, 0 = black, 255 = white. Pre-cropped strip image.
// Returns the status and also writes it to out->status.
int32_t strip_read(const uint8_t* gray, int32_t width, int32_t height, StripResult* out);

// Static string, e.g. "bakeoff-1.0.0". Never free it.
const char* strip_engine_version(void);

#ifdef __cplusplus
}
#endif
#endif
