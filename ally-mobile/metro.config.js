const path = require('path');

const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const tslibEsm = path.resolve(__dirname, 'node_modules/tslib/tslib.es6.js');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  server: {
    port: 8082,
  },
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: ['png', 'jpg', 'jpeg', 'mp3', 'wav', 'm4a', 'mp4'],
    sourceExts: ['js', 'jsx', 'json', 'ts', 'tsx', 'svg'],
    extraNodeModules: {
      '@': `${__dirname}/src`,
    },
    resolveRequest: (context, moduleName, platform) => {
      // ECharts lib/ files use `import { __extends } from "tslib"`.
      // Metro resolves tslib to its CJS entry (tslib.js) whose named
      // exports are invisible to Hermes strict-mode ESM imports.
      // Redirect to the ESM build so __extends is a proper named export.
      if (moduleName === 'tslib') {
        return {
          filePath: tslibEsm,
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
