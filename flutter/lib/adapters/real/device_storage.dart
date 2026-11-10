/// Real storage location: the app's support directory from package:path_provider. The
/// database code itself (lib/core/storage.dart on package:sqlite3) is the same everywhere.
library;

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../core/adapters.dart';
import '../../core/contracts.dart';
import '../../core/storage.dart';

Future<LocalStore> openDeviceStore(String packId) async {
  final dir = await getApplicationSupportDirectory();
  return LocalStore.open(p.join(dir.path, 'slice-$packId.db'));
}

/// Wall clock, truncated to the contract's second precision.
class SystemClock implements Clock {
  const SystemClock();
  @override
  String now() => isoSeconds(DateTime.now());
}
