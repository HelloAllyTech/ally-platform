import React from 'react';
import {
  Dimensions,
  I18nManager,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
} from 'react-native';
import {render} from '@testing-library/react-native';

/**
 * Guards `jest.setup.ts` against the trap it used to be built on.
 *
 * The `react-native` index exposes everything through getters with no setters, so
 * the `RN.Platform = {...}` form the setup used silently did nothing and every test
 * in this repo was quietly reading the real modules — `Platform.Version` came back
 * `undefined`, and the window was 750×1334 rather than the 375×812 the setup
 * claimed. Nothing looked broken because the one value tests actually read,
 * `Platform.OS`, happened to be 'ios' either way.
 *
 * If these fail, the mocks have come unbound again: check that jest.setup mocks the
 * leaf modules (`react-native/Libraries/Utilities/...`) rather than assigning onto
 * the index.
 */
describe('jest.setup mocks are actually bound', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  afterEach(() => {
    Platform.OS = originalOS;
    Platform.Version = originalVersion;
  });

  it('serves the Platform the setup declares', () => {
    expect(Platform.OS).toBe('ios');
    expect(Platform.Version).toBe(13);
    expect(Platform.isTesting).toBe(true);
  });

  it('lets a test take over the platform', () => {
    Platform.OS = 'android';
    Platform.Version = 28;

    expect(Platform.OS).toBe('android');
    expect(Platform.Version).toBe(28);
  });

  it('resolves Platform.select against the platform in force', () => {
    expect(Platform.select({ios: 'i', android: 'a'})).toBe('i');

    Platform.OS = 'android';
    expect(Platform.select({ios: 'i', android: 'a'})).toBe('a');
    expect(Platform.select({default: 'd'})).toBe('d');
  });

  it('serves the window size the setup declares', () => {
    expect(Dimensions.get('window')).toEqual({
      width: 375,
      height: 812,
      scale: 1,
      fontScale: 1,
    });
  });

  it('agrees with useWindowDimensions about that size', () => {
    let seen: {width: number; height: number} | undefined;
    const Probe = () => {
      seen = useWindowDimensions();
      return <Text>probe</Text>;
    };

    render(<Probe />);

    expect(seen).toMatchObject({width: 375, height: 812});
  });

  // Left to the real implementations on purpose — the setup used to shadow these
  // with stubs that would have been a step backwards.
  it('leaves StyleSheet and I18nManager real', () => {
    expect(StyleSheet.flatten([{margin: 1}, {padding: 2}])).toEqual({
      margin: 1,
      padding: 2,
    });
    expect(typeof I18nManager.forceRTL).toBe('function');
  });
});
