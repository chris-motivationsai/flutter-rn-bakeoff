import ExpoModulesCore

// JS-facing module. strip_bridge_read / strip_bridge_version come from cpp/strip_bridge.h, which is the
// pod's public (umbrella) header and therefore visible to Swift in this module.
public class StripEngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StripEngine")

    Function("version") { () -> String in
      return String(cString: strip_bridge_version())
    }

    Function("read") { (gray: Uint8Array, width: Int, height: Int) -> [String: Any] in
      var ratio: Double = 0
      let bytes = UnsafePointer<UInt8>(gray.rawPointer.assumingMemoryBound(to: UInt8.self))
      let status = strip_bridge_read(bytes, gray.byteLength, Int32(width), Int32(height), &ratio)
      return ["status": Int(status), "ratio": ratio]
    }
  }
}
