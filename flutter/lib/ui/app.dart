import 'package:flutter/material.dart';

import '../core/model.dart';
import '../core/pack.dart';
import 'app_controller.dart';

/// The whole app for one stage pack. Title, catalog and shop all come from the pack.
class SliceApp extends StatelessWidget {
  const SliceApp({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: controller.pack.appName,
        theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
        home: TodayScreen(controller: controller),
      );
}

String _label(String type) => type.toUpperCase();

/// One line of text for an observation row.
String describeDisplay(StagePack pack, ObservationView v) {
  final entry = pack.entry(v.obs.type);
  if (entry?.kind == 'strip') {
    final level = v.display['level'] ?? 'unknown';
    final ratio = v.display['ratio'];
    if (ratio != null) return '$level ($ratio)';
    return v.display['locked'] == true ? '$level (number locked)' : '$level';
  }
  return v.display.values.join(', ');
}

void _showOutcome(BuildContext context, Outcome o, {String ok = 'Saved'}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(o.ok ? ok : '${describeError(o.error!)} [${o.error}]')));
}

// ----------------------------------------------------------------------- Today

class TodayScreen extends StatelessWidget {
  const TodayScreen({super.key, required this.controller});
  final AppController controller;

  void _open(BuildContext context, Widget screen) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final s = controller.snapshot;
          final pack = controller.pack;
          final hasStrip = pack.catalog.any((e) => e.sources.contains(Src.stripReader));
          final hasThermo = pack.catalog.any((e) => e.sources.contains(Src.thermometer));
          return Scaffold(
            appBar: AppBar(
              title: Text(pack.appName),
              actions: [
                IconButton(
                  key: const Key('sync-button'),
                  tooltip: 'Sync',
                  icon: const Icon(Icons.sync),
                  onPressed: controller.busy
                      ? null
                      : () async {
                          final o = await controller.sync();
                          if (context.mounted) _showOutcome(context, o, ok: 'Synced');
                        },
                ),
                IconButton(
                  key: const Key('upgrade-button'),
                  tooltip: 'Upgrade',
                  icon: const Icon(Icons.workspace_premium),
                  onPressed: () => _open(context, UpgradeScreen(controller: controller)),
                ),
              ],
            ),
            body: Column(
              children: [
                if (s.conflicts.isNotEmpty)
                  MaterialBanner(
                    key: const Key('conflict-notice'),
                    content: Text(
                      '${s.conflicts.length} of your changes were replaced by a newer copy from another device: '
                      '${s.conflicts.map((c) => '${_label(c.type)} ${c.observedAt}').join('; ')}',
                    ),
                    actions: const [SizedBox.shrink()],
                  ),
                ListTile(
                  key: const Key('pending-count'),
                  dense: true,
                  leading: Icon(s.pendingMutations == 0 ? Icons.cloud_done : Icons.cloud_upload),
                  title: Text(s.pendingMutations == 0
                      ? 'Everything is synced'
                      : '${s.pendingMutations} waiting to sync'),
                ),
                const Divider(height: 1),
                Expanded(
                  child: s.observations.isEmpty
                      ? const Center(child: Text('Nothing logged yet'))
                      : ListView(
                          children: [
                            for (final (i, v) in s.observations.indexed) _ObservationTile(controller, v, i),
                          ],
                        ),
                ),
              ],
            ),
            bottomNavigationBar: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Wrap(
                  alignment: WrapAlignment.spaceEvenly,
                  spacing: 8,
                  children: [
                    FilledButton.icon(
                      key: const Key('add-log-button'),
                      icon: const Icon(Icons.add),
                      label: const Text('Add log'),
                      onPressed: () => _open(context, AddLogScreen(controller: controller)),
                    ),
                    if (hasStrip)
                      OutlinedButton.icon(
                        key: const Key('scan-strip-button'),
                        icon: const Icon(Icons.camera_alt),
                        label: const Text('Scan strip'),
                        onPressed: () => _open(context, ScanStripScreen(controller: controller)),
                      ),
                    if (hasThermo)
                      OutlinedButton.icon(
                        key: const Key('thermometer-button'),
                        icon: const Icon(Icons.thermostat),
                        label: const Text('Thermometer'),
                        onPressed: () => _open(context, ThermometerScreen(controller: controller)),
                      ),
                  ],
                ),
              ),
            ),
          );
        },
      );
}

class _ObservationTile extends StatelessWidget {
  const _ObservationTile(this.controller, this.view, this.index);
  final AppController controller;
  final ObservationView view;
  final int index;

  @override
  Widget build(BuildContext context) {
    final o = view.obs;
    final target = TargetKey(o.type, o.observedAt);
    return ListTile(
      key: Key('obs-$index'),
      title: Text('${_label(o.type)}: ${describeDisplay(controller.pack, view)}'),
      subtitle: Text('${o.observedAt} · ${o.source} · ${view.synced ? 'synced' : 'pending'}'),
      leading: Icon(view.synced ? Icons.cloud_done : Icons.cloud_upload, semanticLabel: view.synced ? 'synced' : 'pending'),
      trailing: PopupMenuButton<String>(
        key: Key('obs-menu-$index'),
        onSelected: (action) async {
          if (action == 'edit') {
            Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => AddLogScreen(controller: controller, editing: view)));
          } else {
            final r = await controller.delete(target);
            if (context.mounted) _showOutcome(context, r, ok: 'Deleted');
          }
        },
        itemBuilder: (_) => [
          // Reader results are read-only: no edit entry for them.
          if (o.source == Src.manual) const PopupMenuItem(value: 'edit', child: Text('Edit')),
          const PopupMenuItem(value: 'delete', child: Text('Delete')),
        ],
      ),
    );
  }
}

// --------------------------------------------------------------------- Add log

/// Manual entry. The form is built from the pack catalog: one choice per entry that
/// allows manual logging, a number field or a set of chips depending on its kind.
class AddLogScreen extends StatefulWidget {
  const AddLogScreen({super.key, required this.controller, this.editing});
  final AppController controller;

  /// When set, the form edits this observation instead of creating one.
  final ObservationView? editing;

  @override
  State<AddLogScreen> createState() => _AddLogScreenState();
}

class _AddLogScreenState extends State<AddLogScreen> {
  late final List<CatalogEntry> _entries;
  late CatalogEntry _entry;
  final _number = TextEditingController();
  String? _choice;
  String? _error;

  @override
  void initState() {
    super.initState();
    final pack = widget.controller.pack;
    final editing = widget.editing;
    _entries = editing != null
        ? [pack.entry(editing.obs.type)!]
        : pack.catalog.where((e) => e.sources.contains(Src.manual)).toList();
    _entry = _entries.first;
    if (editing != null) {
      final v = editing.obs.value[_entry.field];
      if (_entry.kind == 'enum') {
        _choice = v as String?;
      } else {
        _number.text = '$v';
      }
    }
  }

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final Object? raw = _entry.kind == 'enum' ? _choice : num.tryParse(_number.text.trim().replaceAll(',', '.'));
    final value = {_entry.field: raw};
    final editing = widget.editing;
    final o = editing != null
        ? await widget.controller.edit(TargetKey(editing.obs.type, editing.obs.observedAt), value)
        : await widget.controller.logManual(_entry.type, value);
    if (!mounted) return;
    if (o.ok) {
      Navigator.of(context).pop();
    } else {
      setState(() => _error = '${describeError(o.error!)} [${o.error}]');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.editing == null ? 'Add log' : 'Edit log')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (widget.editing == null)
              Wrap(
                spacing: 8,
                children: [
                  for (final e in _entries)
                    ChoiceChip(
                      key: Key('type-${e.type}'),
                      label: Text(_label(e.type)),
                      selected: e == _entry,
                      onSelected: (_) => setState(() {
                        _entry = e;
                        _choice = null;
                        _number.clear();
                        _error = null;
                      }),
                    ),
                ],
              ),
            const SizedBox(height: 16),
            if (_entry.kind == 'enum')
              Wrap(
                spacing: 8,
                children: [
                  for (final v in _entry.values ?? const <String>[])
                    ChoiceChip(
                      key: Key('value-$v'),
                      label: Text(v),
                      selected: _choice == v,
                      onSelected: (_) => setState(() => _choice = v),
                    ),
                ],
              )
            else
              TextField(
                key: const Key('number-field'),
                controller: _number,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: _entry.field,
                  helperText: _entry.min != null && _entry.max != null ? '${_entry.min} to ${_entry.max}' : null,
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(_error!, key: const Key('form-error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            const SizedBox(height: 16),
            FilledButton(key: const Key('save-button'), onPressed: _save, child: const Text('Save')),
          ],
        ),
      );
}

// ------------------------------------------------------------------ Scan strip

class ScanStripScreen extends StatefulWidget {
  const ScanStripScreen({super.key, required this.controller});
  final AppController controller;
  @override
  State<ScanStripScreen> createState() => _ScanStripScreenState();
}

class _ScanStripScreenState extends State<ScanStripScreen> {
  Outcome? _last;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final entry = c.pack.catalog.firstWhere((e) => e.sources.contains(Src.stripReader));
    final last = _last;
    Widget result = const Text('Lay the strip flat in good light, then scan.');
    if (last != null && !last.ok) {
      result = Text('${describeError(last.error!)} [${last.error}]',
          key: const Key('scan-error'), style: TextStyle(color: Theme.of(context).colorScheme.error));
    } else if (last?.observation != null) {
      // Read through the core again so the lock reflects entitlements right now.
      final d = c.core.display(last!.observation!);
      result = Column(
        key: const Key('scan-result'),
        children: [
          Text('${d['level']}', key: const Key('scan-level'), style: Theme.of(context).textTheme.headlineMedium),
          if (d['ratio'] != null) Text('${d['ratio']}', key: const Key('scan-ratio')),
          if (d['locked'] == true) const Text('Upgrade to see the number', key: Key('scan-locked')),
        ],
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Scan strip')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            result,
            const SizedBox(height: 24),
            FilledButton.icon(
              key: const Key('scan-button'),
              icon: const Icon(Icons.camera_alt),
              label: const Text('Scan'),
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() => _busy = true);
                      final o = await c.scanStrip(entry.type);
                      if (mounted) {
                        setState(() {
                          _busy = false;
                          _last = o;
                        });
                      }
                    },
            ),
          ],
        ),
      ),
    );
  }
}

// ----------------------------------------------------------------- Thermometer

class ThermometerScreen extends StatefulWidget {
  const ThermometerScreen({super.key, required this.controller});
  final AppController controller;
  @override
  State<ThermometerScreen> createState() => _ThermometerScreenState();
}

class _ThermometerScreenState extends State<ThermometerScreen> {
  Outcome? _last;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final entry = c.pack.catalog.firstWhere((e) => e.sources.contains(Src.thermometer));
    final last = _last;
    Widget result = const Text('Turn the thermometer on and take your temperature.');
    if (_busy) {
      result = const Text('Listening for the thermometer…', key: Key('thermo-busy'));
    } else if (last != null && !last.ok) {
      result = Text('${describeError(last.error!)} [${last.error}]',
          key: const Key('thermo-error'), style: TextStyle(color: Theme.of(context).colorScheme.error));
    } else if (last?.observation != null) {
      final o = last!.observation!;
      result = Text('${o.value[entry.field]} · ${o.reader?['deviceModel'] ?? ''} · ${o.observedAt}',
          key: const Key('thermo-result'), style: Theme.of(context).textTheme.titleLarge);
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Thermometer')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            result,
            const SizedBox(height: 24),
            FilledButton.icon(
              key: const Key('connect-button'),
              icon: const Icon(Icons.bluetooth),
              label: const Text('Connect'),
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() => _busy = true);
                      final o = await c.readThermometer(entry.type);
                      if (mounted) {
                        setState(() {
                          _busy = false;
                          _last = o;
                        });
                      }
                    },
            ),
          ],
        ),
      ),
    );
  }
}

// --------------------------------------------------------------------- Upgrade

class UpgradeScreen extends StatelessWidget {
  const UpgradeScreen({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final s = controller.snapshot;
          final products = controller.pack.products;
          return Scaffold(
            appBar: AppBar(title: const Text('Upgrade')),
            body: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (products.isEmpty)
                  const Text('There is nothing to buy in this app.', key: Key('no-products'))
                else ...[
                  for (final p in products)
                    Card(
                      child: ListTile(
                        title: Text(p.productId),
                        subtitle: Text(s.entitlements.contains(p.entitlement)
                            ? 'Active: ${p.entitlement}'
                            : 'Unlocks ${p.entitlement}'),
                        trailing: FilledButton(
                          key: Key('buy-${p.productId}'),
                          onPressed: controller.busy
                              ? null
                              : () async {
                                  final o = await controller.purchase(p.productId);
                                  if (context.mounted) _showOutcome(context, o, ok: 'Done');
                                },
                          child: const Text('Buy'),
                        ),
                      ),
                    ),
                  TextButton(
                    key: const Key('restore-button'),
                    onPressed: controller.busy ? null : controller.restore,
                    child: const Text('Restore purchases'),
                  ),
                ],
                const SizedBox(height: 16),
                Text('Purchase state: ${s.purchaseState}', key: const Key('purchase-state')),
                Text(
                  s.entitlements.isEmpty ? 'No active entitlements' : 'Active: ${s.entitlements.join(', ')}',
                  key: const Key('entitlements'),
                ),
                if (s.purchaseState == 'verifying')
                  const Text('Your purchase is saved and will be confirmed when the server can be reached.',
                      key: Key('verifying-note')),
                if (s.lastPurchaseError != null)
                  Text('${describeError(s.lastPurchaseError!)} [${s.lastPurchaseError}]',
                      key: const Key('purchase-error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
            ),
          );
        },
      );
}
