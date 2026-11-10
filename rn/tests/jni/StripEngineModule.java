// Host-JVM stand-in for the Kotlin module (android/.../StripEngineModule.kt): same package, class name and
// native method signatures, so the JVM binds to the very JNI functions in strip_jni.cpp that Android would.
// Usage: java StripEngineModule.java <libstrip-engine.dylib> <file.pgm>...   prints "<status> <ratio>" per file.
package expo.modules.stripengine;

import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Paths;

public class StripEngineModule {
  private native String nativeVersion();
  private native double[] nativeRead(ByteBuffer gray, int width, int height);

  public static void main(String[] args) throws Exception {
    System.load(args[0]);
    StripEngineModule module = new StripEngineModule();
    System.out.println(module.nativeVersion());
    for (int i = 1; i < args.length; i++) {
      byte[] file = Files.readAllBytes(Paths.get(args[i]));
      // "P5\n<width> <height>\n255\n" then the pixels
      int pos = 0, field = 0;
      int[] header = new int[3];
      pos = 2;
      while (field < 3) {
        while (Character.isWhitespace(file[pos])) pos++;
        int value = 0;
        while (!Character.isWhitespace(file[pos])) value = value * 10 + (file[pos++] - '0');
        header[field++] = value;
      }
      pos++;
      ByteBuffer gray = ByteBuffer.allocateDirect(file.length - pos);
      gray.put(file, pos, file.length - pos);
      double[] result = module.nativeRead(gray, header[0], header[1]);
      System.out.println((int) result[0] + " " + result[1]);
    }
    // wrong size: the bridge must refuse instead of reading past the buffer
    double[] bad = module.nativeRead(ByteBuffer.allocateDirect(10), 200, 60);
    System.out.println("bad " + (int) bad[0]);
  }
}
