// JS face of the native strip engine module. See ios/StripEngineModule.swift and
// android/src/main/java/expo/modules/stripengine/StripEngineModule.kt.
import { requireNativeModule } from 'expo-modules-core';

export type StripEngineNativeModule = {
  /** strip_engine_version() */
  version(): string;
  /** strip_read() on width*height gray bytes. `status` is the engine status code (0 = ok). */
  read(gray: Uint8Array, width: number, height: number): { status: number; ratio: number };
};

export default requireNativeModule<StripEngineNativeModule>('StripEngine');
