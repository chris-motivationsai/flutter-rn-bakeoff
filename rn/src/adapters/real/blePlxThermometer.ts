// Bluetooth thermometer over react-native-ble-plx. It only moves bytes: scan for the Health Thermometer
// service, connect, forward 2A1C / 2A1E notifications, report the disconnect. Decoding lives in core/thermometer.ts.
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, fullUUID, type Device, type Subscription } from 'react-native-ble-plx';
import { base64ToBytes } from '../../core/numbers';
import type { Thermometer, ThermometerEvent } from '../../core/ports';
import { FINAL_MEASUREMENT_CHAR, HEALTH_THERMOMETER_SERVICE, INTERMEDIATE_CHAR } from '../../core/thermometer';

const SCAN_TIMEOUT_MS = 30000;

/** "00002a1c-0000-1000-8000-00805f9b34fb" -> "2A1C" */
export const shortUuid = (uuid: string): string => fullUUID(uuid).slice(4, 8).toUpperCase();

export class BlePlxThermometer implements Thermometer {
  private manager: BleManager | null = null;

  async runSession(listener: (event: ThermometerEvent) => boolean): Promise<void> {
    const manager = (this.manager ??= new BleManager());
    await requestAndroidPermissions();
    await waitForPoweredOn(manager);
    const found = await this.scan(manager);
    if (!found) return; // nothing nearby: the core reports "no final reading"

    const subscriptions: Subscription[] = [];
    let wanted = true;
    await new Promise<void>((resolve) => {
      let over = false;
      const end = () => {
        if (over) return;
        over = true;
        resolve();
      };
      const emit = (event: ThermometerEvent) => {
        if (!wanted) return;
        wanted = listener(event);
        if (!wanted) end();
      };
      subscriptions.push(
        manager.onDeviceDisconnected(found.id, () => {
          emit({ event: 'disconnect' });
          end();
        }),
      );
      const monitor = (device: Device, characteristic: string) =>
        manager.monitorCharacteristicForDevice(device.id, fullUUID(HEALTH_THERMOMETER_SERVICE), fullUUID(characteristic), (error, update) => {
          if (error || !update?.value) return;
          emit({ event: 'notify', char: shortUuid(update.uuid), bytes: base64ToBytes(update.value) });
        });
      manager
        .connectToDevice(found.id)
        .then((device) => device.discoverAllServicesAndCharacteristics())
        .then((device) => {
          emit({ event: 'connect', deviceName: device.name ?? device.localName ?? found.name ?? found.localName ?? device.id });
          subscriptions.push(monitor(device, INTERMEDIATE_CHAR), monitor(device, FINAL_MEASUREMENT_CHAR));
        })
        .catch(() => {
          emit({ event: 'disconnect' });
          end();
        });
    });
    subscriptions.forEach((subscription) => subscription.remove());
    await manager.cancelDeviceConnection(found.id).catch(() => undefined);
  }

  private scan(manager: BleManager): Promise<Device | null> {
    return new Promise((resolve) => {
      const finish = (device: Device | null) => {
        clearTimeout(timer);
        void manager.stopDeviceScan();
        resolve(device);
      };
      const timer = setTimeout(() => finish(null), SCAN_TIMEOUT_MS);
      void manager.startDeviceScan([fullUUID(HEALTH_THERMOMETER_SERVICE)], null, (error, device) => {
        if (error) finish(null);
        else if (device) finish(device);
      });
    });
  }
}

function waitForPoweredOn(manager: BleManager): Promise<void> {
  return new Promise((resolve) => {
    // The listener may fire before onStateChange has returned its subscription.
    let subscription: Subscription | null = null;
    let done = false;
    subscription = manager.onStateChange((state) => {
      if (state !== State.PoweredOn || done) return;
      done = true;
      subscription?.remove();
      resolve();
    }, true);
    if (done) subscription.remove();
  });
}

async function requestAndroidPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
}
