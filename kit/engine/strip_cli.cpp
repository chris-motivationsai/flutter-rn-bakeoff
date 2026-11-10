// strip_cli <file.pgm> -> prints: <status> <ratio with 17 significant digits>
#include "strip_engine.h"
#include <cstdio>
#include <vector>
int main(int argc, char** argv) {
  if (argc < 2) return 2;
  FILE* f = fopen(argv[1], "rb"); if (!f) return 2;
  int w = 0, h = 0, maxv = 0;
  if (fscanf(f, "P5 %d %d %d", &w, &h, &maxv) != 3) return 2;
  fgetc(f);
  std::vector<uint8_t> buf(size_t(w) * h);
  if (fread(buf.data(), 1, buf.size(), f) != buf.size()) return 2;
  StripResult r; strip_read(buf.data(), w, h, &r);
  printf("%d %.17g\n", r.status, r.ratio);
  return 0;
}
