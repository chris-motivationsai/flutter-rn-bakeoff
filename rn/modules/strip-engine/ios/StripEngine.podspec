require 'fileutils'

Pod::Spec.new do |s|
  s.name           = 'StripEngine'
  s.version        = '1.0.0'
  s.summary        = 'Expo module wrapping the C++ strip engine'
  s.description    = 'Exposes strip_read / strip_engine_version from the kit C++ engine to JavaScript.'
  s.license        = 'UNLICENSED'
  s.author         = 'bakeoff'
  s.homepage       = 'https://example.invalid/strip-engine'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # CocoaPods cannot compile files outside the pod's directory, so the shared C++ (the bridge and the
  # engine source synced unmodified from kit/engine by scripts/sync-engine.sh) is copied next to the podspec.
  cpp = File.join(__dir__, '..', 'cpp')
  vendored = File.join(__dir__, 'cpp')
  FileUtils.rm_rf(vendored)
  FileUtils.mkdir_p(File.join(vendored, 'engine'))
  FileUtils.cp(Dir.glob(File.join(cpp, '*.{h,cpp}')), vendored)
  FileUtils.cp(Dir.glob(File.join(cpp, 'engine', '*.{h,cpp}')), File.join(vendored, 'engine'))

  s.source_files = '*.swift', 'cpp/**/*.{h,cpp}'
  # Only the C bridge header is visible to Swift; the engine header stays private to the C++ sources.
  s.public_header_files = 'cpp/strip_bridge.h'
  s.private_header_files = 'cpp/engine/*.h'
  s.header_mappings_dir = 'cpp'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.library = 'c++'
end
