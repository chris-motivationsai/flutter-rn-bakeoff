// The contracts and packs live outside this project, in ../kit, and are imported, not copied.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const kit = path.resolve(__dirname, '..', 'kit');

config.watchFolders = [path.join(kit, 'contracts'), path.join(kit, 'packs')];

// kit/contracts/schemas.ts imports zod; give it this app's copy so there is exactly one zod in the bundle.
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (moduleName === 'zod' || moduleName.startsWith('zod/')) {
    return resolve({ ...context, originModulePath: path.join(__dirname, 'index.ts') }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
