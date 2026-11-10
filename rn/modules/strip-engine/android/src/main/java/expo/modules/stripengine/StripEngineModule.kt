package expo.modules.stripengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.nio.ByteBuffer

class StripEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StripEngine")

    Function("version") {
      nativeVersion()
    }

    Function("read") { gray: Uint8Array, width: Int, height: Int ->
      val result = nativeRead(gray.toDirectBuffer(), width, height)
      mapOf("status" to result[0].toInt(), "ratio" to result[1])
    }
  }

  private external fun nativeVersion(): String
  private external fun nativeRead(gray: ByteBuffer, width: Int, height: Int): DoubleArray

  companion object {
    init {
      System.loadLibrary("strip-engine")
    }
  }
}
