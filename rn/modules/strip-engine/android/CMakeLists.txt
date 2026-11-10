cmake_minimum_required(VERSION 3.13)
project(strip-engine)

set(CMAKE_CXX_STANDARD 17)
set(SHARED_CPP "${CMAKE_SOURCE_DIR}/../cpp")

# The engine source is the unmodified copy of kit/engine kept in ../cpp/engine by scripts/sync-engine.sh.
add_library(
  strip-engine
  SHARED
  "${SHARED_CPP}/engine/strip_engine.cpp"
  "${SHARED_CPP}/strip_bridge.cpp"
  "${CMAKE_SOURCE_DIR}/src/main/cpp/strip_jni.cpp"
)
target_include_directories(strip-engine PRIVATE "${SHARED_CPP}")
