// The C++ strip engine on a phone: the local Expo module in modules/strip-engine (Swift / Kotlin+JNI over
// the shared C++ bridge). Synchronous JSI calls; the Uint8Array is passed without copying to base64.
import StripEngineModule from '../../../modules/strip-engine';
import type { StripEngine } from '../../core/ports';

export const nativeStripEngine: StripEngine = {
  version: () => StripEngineModule.version(),
  read: (gray, width, height) => StripEngineModule.read(gray, width, height),
};
