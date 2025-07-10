module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: {
          '@': './src',
        },
      },
    ],
    // react-native-reanimated/plugin has to be listed last
    'react-native-reanimated/plugin',
  ],
};
