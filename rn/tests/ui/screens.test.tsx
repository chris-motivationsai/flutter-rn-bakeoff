// Component tests: the real screens over the real core (fakes for the device, the kit server for HTTP).
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppRoot } from '../../src/ui/AppRoot';
import { createHarness, frame, NodeHttp, receipt, session, stripImage, flatImage, type Harness } from '../helpers/harness';
import { TestServer } from '../helpers/server';

const server = new TestServer();
const USER = 'u-ui';
let h: Harness;
const open = (packId: 'polly' | 'premom') => (h = createHarness(server.url, packId, undefined, new NodeHttp(server.url)));

beforeAll(() => server.start());
afterAll(() => server.stop());
beforeEach(() => server.reset(USER));
afterEach(() => h?.dispose());

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const text = (testID: string) => {
  const flatten = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(flatten).join('') : node && typeof node === 'object' && 'children' in node ? flatten((node as { children: unknown }).children) : '');
  return flatten(screen.getByTestId(testID).props.children);
};

describe('Today', () => {
  test('lists observations with their sync state, the pending count, and syncs', async () => {
    open('premom');
    await h.log('2026-11-03T06:40:00Z', 'bbt', { celsius: 36.61 });
    await h.log('2026-11-03T08:00:00Z', 'flow', { code: 'medium' });
    await render(<AppRoot core={h.app} />);

    expect(screen.getByText('Premom')).toBeTruthy();
    expect(text('pending-count')).toBe('2 waiting to sync');
    expect(screen.getByText('bbt · 36.61')).toBeTruthy();
    expect(screen.getByText('2026-11-03 06:40 · manual · pending')).toBeTruthy();
    expect(screen.getByText('flow · medium')).toBeTruthy();
    expect(screen.queryByTestId('conflict-notice')).toBeNull();

    await press('sync-button');
    await waitFor(() => expect(text('pending-count')).toBe('Everything is synced'));
    expect(screen.getByText('2026-11-03 06:40 · manual · synced')).toBeTruthy();
    expect(await server.live()).toHaveLength(2);
  });

  test('shows an empty state, and a readable error when the server is unreachable', async () => {
    open('polly');
    await render(<AppRoot core={h.app} />);
    expect(screen.getByText('Polly')).toBeTruthy();
    expect(screen.getByTestId('empty-list')).toBeTruthy();
    await h.log('2026-11-03T08:00:00Z', 'flow', { code: 'light' });
    await server.control({ mode: 'down' });
    await press('sync-button');
    await waitFor(() => expect(text('outcome-error')).toMatch(/Could not reach the server/));
    expect(text('pending-count')).toBe('1 waiting to sync');
  });

  test('shows a conflict notice naming what was overwritten', async () => {
    open('premom');
    const at = '2026-11-03T08:00:00Z';
    await h.log(at, 'flow', { code: 'heavy' });
    await h.app.sync();
    await server.control({ remote: { op: 'upsert', type: 'flow', observedAt: at, value: { code: 'spotting' }, source: 'manual' } });
    await h.app.edit({ type: 'flow', observedAt: at }, { code: 'light' });
    await render(<AppRoot core={h.app} />);
    expect(screen.getByText('flow · light')).toBeTruthy();
    await press('sync-button');
    await waitFor(() => expect(screen.getByTestId('conflict-notice')).toBeTruthy());
    expect(text('conflict-item')).toBe('flow · 2026-11-03 08:00');
    expect(screen.getByText('flow · spotting')).toBeTruthy();
  });

  test('edit and delete act on the row; device readings have no edit button', async () => {
    open('premom');
    const at = '2026-11-03T08:00:00Z';
    await h.log(at, 'flow', { code: 'heavy' });
    await h.scan('2026-11-03T14:00:00Z', stripImage(100, 70));
    await render(<AppRoot core={h.app} />);
    expect(screen.queryByTestId('edit-lh|2026-11-03T14:00:00Z')).toBeNull();

    await press(`edit-flow|${at}`);
    await press('choice-spotting');
    await press('save-edit');
    await waitFor(() => expect(screen.getByText('flow · spotting')).toBeTruthy());

    await press('delete-lh|2026-11-03T14:00:00Z');
    await waitFor(() => expect(screen.queryByText(/^lh · /)).toBeNull());
    expect(h.app.snapshot().observations.map((o) => o.type)).toEqual(['flow']);
  });
});

describe('Add log', () => {
  test('the form is built from the pack: Premom offers mucus, Polly does not, neither offers lh', async () => {
    open('premom');
    const first = await render(<AppRoot core={h.app} />);
    await press('tab-add');
    expect(screen.getByTestId('type-bbt')).toBeTruthy();
    expect(screen.getByTestId('type-flow')).toBeTruthy();
    expect(screen.getByTestId('type-mucus')).toBeTruthy();
    expect(screen.queryByTestId('type-lh')).toBeNull();
    await press('type-mucus');
    for (const code of ['dry', 'sticky', 'creamy', 'watery', 'eggwhite']) expect(screen.getByTestId(`choice-${code}`)).toBeTruthy();
    await first.unmount();
    h.dispose();

    open('polly');
    await render(<AppRoot core={h.app} />);
    await press('tab-add');
    expect(screen.getByTestId('type-flow')).toBeTruthy();
    expect(screen.queryByTestId('type-mucus')).toBeNull();
    expect(screen.queryByTestId('type-lh')).toBeNull();
  });

  test('saving a number and a choice creates observations in the core', async () => {
    open('premom');
    h.at('2026-11-03T06:40:00Z');
    await render(<AppRoot core={h.app} />);
    await press('tab-add');
    await press('type-bbt');
    await fireEvent.changeText(screen.getByTestId('value-input'), '36.72');
    await press('save-log');
    await waitFor(() => expect(text('outcome-ok')).toBe('Saved'));

    h.at('2026-11-03T08:00:00Z');
    await press('type-flow');
    await press('choice-heavy');
    await press('save-log');
    await waitFor(() => expect(h.app.snapshot().observations).toHaveLength(2));
    expect(h.app.snapshot().observations.map((o) => [o.type, o.display, o.source])).toEqual([
      ['bbt', { celsius: 36.72 }, 'manual'],
      ['flow', { code: 'heavy' }, 'manual'],
    ]);
    await press('tab-today');
    expect(screen.getByText('bbt · 36.72')).toBeTruthy();
  });

  test('an out-of-range or empty value shows an error and saves nothing', async () => {
    open('premom');
    await render(<AppRoot core={h.app} />);
    await press('tab-add');
    await press('type-bbt');
    await fireEvent.changeText(screen.getByTestId('value-input'), '45');
    await press('save-log');
    await waitFor(() => expect(text('outcome-error')).toBe('That value is not valid.'));
    await fireEvent.changeText(screen.getByTestId('value-input'), '');
    await press('save-log');
    await press('type-flow');
    await press('save-log'); // nothing picked
    await waitFor(() => expect(text('outcome-error')).toBe('That value is not valid.'));
    expect(h.app.snapshot().observations).toEqual([]);
  });
});

describe('Scan strip', () => {
  test('Premom shows the level with the number locked', async () => {
    open('premom');
    h.at('2026-11-03T14:00:00Z');
    await render(<AppRoot core={h.app} />);
    await press('tab-scan');
    h.camera.next = stripImage(100, 70);
    await press('scan-button');
    await waitFor(() => expect(text('latest-strip')).toBe('Latest: high · number locked'));
    expect(text('outcome-ok')).toBe('Strip read');
  });

  test('Polly shows only its own level word', async () => {
    open('polly');
    h.at('2026-11-03T14:00:00Z');
    await render(<AppRoot core={h.app} />);
    await press('tab-scan');
    h.camera.next = stripImage(100, 90);
    await press('scan-button');
    await waitFor(() => expect(text('latest-strip')).toBe('Latest: positive'));
  });

  test('a failed read shows why and adds nothing', async () => {
    open('premom');
    await render(<AppRoot core={h.app} />);
    await press('tab-scan');
    h.camera.next = flatImage(10);
    await press('scan-button');
    await waitFor(() => expect(text('outcome-error')).toBe('The photo is too dark.'));
    expect(screen.queryByTestId('latest-strip')).toBeNull();
    expect(h.app.snapshot().observations).toEqual([]);
  });
});

describe('Thermometer', () => {
  test('a session logs the final reading and shows it', async () => {
    open('polly');
    h.at('2026-11-03T06:30:00Z');
    await render(<AppRoot core={h.app} />);
    await press('tab-thermometer');
    h.thermometer.script = session(frame({ mantissa: 3668, exponent: -2 }), 'Polly-Thermo-1');
    await press('thermo-button');
    await waitFor(() => expect(text('latest-temperature')).toBe('Latest: 36.68 · 2026-11-03 06:30'));
    expect(h.app.snapshot().observations[0]).toMatchObject({ type: 'bbt', source: 'thermometer' });
  });

  test('a session without a final reading shows the reason', async () => {
    open('polly');
    await render(<AppRoot core={h.app} />);
    await press('tab-thermometer');
    h.thermometer.script = session(null);
    await press('thermo-button');
    await waitFor(() => expect(text('outcome-error')).toMatch(/disconnected before a final reading/));
    expect(h.app.snapshot().observations).toEqual([]);
  });
});

describe('Upgrade', () => {
  const good = { txId: 'tx-ui', receipt: receipt({ txId: 'tx-ui', userId: USER, expiresAt: '2026-12-03T14:00:00Z' }) };

  test('Polly sells nothing: there is no Upgrade tab', async () => {
    open('polly');
    await render(<AppRoot core={h.app} />);
    expect(screen.queryByTestId('tab-upgrade')).toBeNull();
    expect(screen.getByTestId('tab-scan')).toBeTruthy();
  });

  test('buying unlocks the number once the server has verified the receipt', async () => {
    open('premom');
    await h.scan('2026-11-03T14:00:00Z', stripImage(100, 70));
    h.at('2026-11-03T14:01:00Z');
    await render(<AppRoot core={h.app} />);
    expect(screen.getByText('lh · high · number locked')).toBeTruthy();
    await press('tab-upgrade');
    h.store.purchaseScript = [{ event: 'purchased', ...good }];
    await press('buy-premium_monthly');
    await waitFor(() => expect(screen.getByTestId('owned-premium_monthly')).toBeTruthy());
    expect(screen.queryByTestId('buy-premium_monthly')).toBeNull();
    await press('tab-today');
    expect(screen.getByText('lh · high · 0.7')).toBeTruthy();
  });

  test('while the server is unreachable the purchase is "verifying" and nothing unlocks', async () => {
    open('premom');
    await server.control({ mode: 'down' });
    await render(<AppRoot core={h.app} />);
    await press('tab-upgrade');
    h.store.purchaseScript = [{ event: 'purchased', ...good }];
    await press('buy-premium_monthly');
    await waitFor(() => expect(text('purchase-state')).toMatch(/once it has been verified/));
    expect(screen.queryByTestId('owned-premium_monthly')).toBeNull();
  });

  test('a refused receipt shows the reason; restore brings a valid purchase back', async () => {
    open('premom');
    await render(<AppRoot core={h.app} />);
    await press('tab-upgrade');
    h.store.purchaseScript = [{ event: 'purchased', txId: 'tx-x', receipt: receipt({ txId: 'tx-x', userId: 'u-other', expiresAt: '2026-12-03T14:00:00Z' }) }];
    await press('buy-premium_monthly');
    await waitFor(() => expect(text('purchase-error')).toBe('That purchase belongs to another account.'));
    expect(screen.queryByTestId('owned-premium_monthly')).toBeNull();

    h.store.restoreScript = [good];
    await press('restore-button');
    await waitFor(() => expect(screen.getByTestId('owned-premium_monthly')).toBeTruthy());
    expect(screen.queryByTestId('purchase-error')).toBeNull();
  });

  test('a cancelled purchase says so without showing an error', async () => {
    open('premom');
    await render(<AppRoot core={h.app} />);
    await press('tab-upgrade');
    h.store.purchaseScript = [{ event: 'cancelled' }];
    await press('buy-premium_monthly');
    await waitFor(() => expect(text('outcome-error')).toBe('Purchase cancelled.'));
    expect(screen.queryByTestId('purchase-error')).toBeNull();
  });
});
