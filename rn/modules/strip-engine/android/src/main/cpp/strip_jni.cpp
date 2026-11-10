// JNI glue for expo.modules.stripengine.StripEngineModule. Counterpart of node/strip_napi.cpp and
// ios/StripEngineModule.swift: it only unwraps arguments and calls the shared bridge.
#include <jni.h>
#include "strip_bridge.h"

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_stripengine_StripEngineModule_nativeVersion(JNIEnv* env, jobject) {
  return env->NewStringUTF(strip_bridge_version());
}

// Returns [status, ratio]. `gray` is a direct ByteBuffer over the JS Uint8Array (no copy).
extern "C" JNIEXPORT jdoubleArray JNICALL
Java_expo_modules_stripengine_StripEngineModule_nativeRead(JNIEnv* env, jobject, jobject gray, jint width, jint height) {
  double ratio = 0.0;
  int32_t status = 4;  // STRIP_BAD_INPUT
  void* data = gray ? env->GetDirectBufferAddress(gray) : nullptr;
  jlong length = gray ? env->GetDirectBufferCapacity(gray) : -1;
  if (data && length >= 0) {
    status = strip_bridge_read(static_cast<const uint8_t*>(data), static_cast<size_t>(length), width, height, &ratio);
  }
  jdouble values[2] = {static_cast<jdouble>(status), ratio};
  jdoubleArray result = env->NewDoubleArray(2);
  env->SetDoubleArrayRegion(result, 0, 2, values);
  return result;
}
