import {Platform} from 'react-native';

import {installScriptSafeFontFallback} from '../scriptSafeFontFallback';

// Its own file: the installer is idempotent by design, so each gate needs a fresh
// module registry to observe.
describe('installScriptSafeFontFallback platform gate', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  afterEach(() => {
    Platform.OS = originalOS;
    Platform.Version = originalVersion;
  });

  const targetWithSpy = () => {
    const original = jest.fn();
    return {target: {render: original}, original};
  };

  it('leaves rendering alone on Android 10+, where ScriptFallbackFonts.kt handles it', () => {
    Platform.OS = 'android';
    Platform.Version = 29;
    const {target, original} = targetWithSpy();

    installScriptSafeFontFallback({text: target, textInput: target});

    expect(target.render).toBe(original);
  });

  it('leaves rendering alone on iOS, where CoreText falls back on its own', () => {
    Platform.OS = 'ios';
    const {target, original} = targetWithSpy();

    installScriptSafeFontFallback({text: target, textInput: target});

    expect(target.render).toBe(original);
  });

  it('installs on Android 9', () => {
    Platform.OS = 'android';
    Platform.Version = 28;
    const {target, original} = targetWithSpy();

    installScriptSafeFontFallback({text: target, textInput: target});

    expect(target.render).not.toBe(original);
  });
});
