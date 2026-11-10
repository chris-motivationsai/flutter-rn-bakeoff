import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
// EXPO_PUBLIC_DEVICE_TEST=1 (inlined by Metro) swaps the screens for the on-device test in device-test/.
if (process.env.EXPO_PUBLIC_DEVICE_TEST === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- keeps the test out of normal bundles
  registerRootComponent(require('./device-test/main').default);
} else {
  registerRootComponent(App);
}
