#include "strip_engine.h"
#include <algorithm>
#include <vector>

static double zone_peak(const std::vector<double>& s, int from, int to, double baseline) {
  double best = 0.0;
  for (int x = from; x < to; ++x) best = std::max(best, s[x] - baseline);
  return best;
}

extern "C" int32_t strip_read(const uint8_t* gray, int32_t width, int32_t height, StripResult* out) {
  if (!out) return STRIP_BAD_INPUT;
  out->status = STRIP_BAD_INPUT; out->ratio = 0; out->control_intensity = 0; out->test_intensity = 0;
  if (!gray || width < 50 || height < 10) return STRIP_BAD_INPUT;

  std::vector<double> dark(width, 0.0);
  double total = 0.0;
  for (int x = 0; x < width; ++x) {
    double sum = 0.0;
    for (int y = 0; y < height; ++y) sum += gray[y * width + x];
    total += sum;
    dark[x] = 255.0 - sum / height;
  }
  double mean = total / (double(width) * height);
  if (mean < 40.0) { out->status = STRIP_TOO_DARK; return STRIP_TOO_DARK; }
  if (mean > 245.0) { out->status = STRIP_TOO_BRIGHT; return STRIP_TOO_BRIGHT; }

  std::vector<double> sorted(dark);
  std::sort(sorted.begin(), sorted.end());
  double baseline = sorted[width / 2];

  std::vector<double> smooth(width, 0.0);
  for (int x = 0; x < width; ++x) {
    double sum = 0.0; int n = 0;
    for (int k = -2; k <= 2; ++k) { int i = x + k; if (i >= 0 && i < width) { sum += dark[i]; ++n; } }
    smooth[x] = sum / n;
  }
  double control = zone_peak(smooth, int(width * 0.60), int(width * 0.75), baseline);
  double test = zone_peak(smooth, int(width * 0.35), int(width * 0.50), baseline);
  out->control_intensity = control; out->test_intensity = test;
  if (control < 12.0) { out->status = STRIP_NO_CONTROL_LINE; return STRIP_NO_CONTROL_LINE; }
  out->ratio = test / control;
  out->status = STRIP_OK;
  return STRIP_OK;
}

extern "C" const char* strip_engine_version(void) { return "bakeoff-1.0.0"; }
