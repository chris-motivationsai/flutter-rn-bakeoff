// The app shell: five screens over one AppCore. Which tabs exist is decided by the pack.
import React, { useState } from 'react';
import { Pressable, SafeAreaView, Text, View } from 'react-native';
import type { AppCore } from '../core/app';
import { AddLogScreen } from './AddLogScreen';
import { styles } from './kit';
import { ScanStripScreen } from './ScanStripScreen';
import { ThermometerScreen } from './ThermometerScreen';
import { TodayScreen } from './TodayScreen';
import { UpgradeScreen } from './UpgradeScreen';

type Tab = 'today' | 'add' | 'scan' | 'thermometer' | 'upgrade';

export function AppRoot({ core, CameraPreview }: { core: AppCore; CameraPreview?: React.ComponentType }) {
  const [tab, setTab] = useState<Tab>('today');
  const stripType = core.pack.catalog.find((entry) => entry.sources.includes('strip_reader'))?.type;
  const thermometerType = core.pack.catalog.find((entry) => entry.sources.includes('thermometer'))?.type;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'add', label: 'Add log' },
    ...(stripType ? [{ id: 'scan' as const, label: 'Scan strip' }] : []),
    ...(thermometerType ? [{ id: 'thermometer' as const, label: 'Thermometer' }] : []),
    ...(core.pack.products.length > 0 ? [{ id: 'upgrade' as const, label: 'Upgrade' }] : []),
  ];

  return (
    <SafeAreaView style={styles.grow}>
      <View style={styles.grow}>
        {tab === 'today' ? <TodayScreen core={core} /> : null}
        {tab === 'add' ? <AddLogScreen core={core} /> : null}
        {tab === 'scan' && stripType ? <ScanStripScreen core={core} type={stripType} CameraPreview={CameraPreview} /> : null}
        {tab === 'thermometer' && thermometerType ? <ThermometerScreen core={core} type={thermometerType} /> : null}
        {tab === 'upgrade' ? <UpgradeScreen core={core} /> : null}
      </View>
      <View style={styles.tabs}>
        {tabs.map((item) => (
          <Pressable key={item.id} testID={`tab-${item.id}`} accessibilityRole="tab" style={[styles.tab, tab === item.id ? styles.tabOn : null]} onPress={() => setTab(item.id)}>
            <Text>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
