// Upgrade: buy or restore what the pack sells. Unlocks only after the server has verified the receipt.
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { AppCore } from '../core/app';
import type { Result } from '../core/types';
import { Button, Outcome, styles } from './kit';
import { errorText } from './text';
import { useSnapshot } from './useSnapshot';

const STATE_TEXT = {
  idle: '',
  pending: 'The store is still processing your purchase.',
  verifying: 'Purchase received. It will unlock once it has been verified.',
} as const;

export function UpgradeScreen({ core }: { core: AppCore }) {
  const snapshot = useSnapshot(core);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<Result>) => {
    setBusy(true);
    try {
      setResult(await action());
    } catch {
      setResult({ ok: false, error: 'store_error' });
    }
    setBusy(false);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Upgrade</Text>
      {core.pack.products.length === 0 ? <Text testID="no-products">There is nothing to buy in this app.</Text> : null}
      {core.pack.products.map((product) => {
        const owned = snapshot.entitlements.includes(product.entitlement);
        return (
          <View key={product.productId} style={styles.row}>
            <Text style={styles.grow}>{product.entitlement}</Text>
            {owned ? (
              <Text testID={`owned-${product.productId}`} style={styles.ok}>Active</Text>
            ) : (
              <Button testID={`buy-${product.productId}`} label="Buy" disabled={busy} onPress={() => run(() => core.purchase(product.productId))} />
            )}
          </View>
        );
      })}
      {core.pack.products.length > 0 ? <Button testID="restore-button" label="Restore purchases" disabled={busy} onPress={() => run(() => core.restore())} /> : null}
      {snapshot.purchaseState !== 'idle' ? <Text testID="purchase-state">{STATE_TEXT[snapshot.purchaseState]}</Text> : null}
      {snapshot.lastPurchaseError ? <Text testID="purchase-error" style={styles.error}>{errorText(snapshot.lastPurchaseError)}</Text> : null}
      {result && !result.ok && result.error === 'cancelled' ? <Outcome result={result} success="" /> : null}
    </View>
  );
}
