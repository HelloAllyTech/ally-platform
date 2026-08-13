import React from 'react';
import {Platform, StyleSheet, Text} from 'react-native';
import {render} from '@testing-library/react-native';

import {installScriptSafeFontFallback} from '../scriptSafeFontFallback';

// React Native's jest preset replaces Text/TextInput with class mocks that copy
// statics but never call them, so patching the exported components proves nothing
// here. These are the real implementations the app ships with.
const RealText = jest.requireActual('react-native/Libraries/Text/Text')
  .default as typeof Text;

// The real TextInput cannot mount under this preset (its native half is stubbed
// out), so the TextInput half is asserted through the render contract the patch
// wraps: what props reach the original render.
const textInputRender = jest.fn(() => null);
const textInputTarget: {render: (props: unknown, ref: unknown) => unknown} = {
  render: textInputRender,
};

const originalOS = Platform.OS;
const originalVersion = Platform.Version;

const fontOf = (element: {props: {style?: unknown}}) =>
  StyleSheet.flatten(element.props.style as never) as {
    fontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    fontSize?: number;
    color?: string;
  };

const renderText = (children: React.ReactNode, style: object) =>
  fontOf(
    render(
      <RealText testID="label" style={style}>
        {children}
      </RealText>,
    ).getByTestId('label'),
  );

const renderTextInput = (props: object) => {
  textInputTarget.render(props, null);
  const [received] = textInputRender.mock.calls[
    textInputRender.mock.calls.length - 1
  ] as unknown as [{style?: unknown}];
  return fontOf({props: received});
};

describe('installScriptSafeFontFallback', () => {
  beforeAll(() => {
    // This half of the fix only runs on Android below API 29; 10+ is handled
    // natively by ScriptFallbackFonts.
    Platform.OS = 'android';
    Platform.Version = 28;
    installScriptSafeFontFallback({text: RealText, textInput: textInputTarget});
  });

  afterAll(() => {
    Platform.OS = originalOS;
    Platform.Version = originalVersion;
  });

  it('moves Indic text off the Latin-only bundled font', () => {
    expect(renderText('தமிழ்', {fontFamily: 'IBMPlexSerif-Regular'}).fontFamily).toBe(
      'sans-serif',
    );
  });

  it.each([
    ['Devanagari', 'भाषा'],
    ['Tamil', 'மொழி'],
    ['Kannada', 'ಭಾಷೆ'],
    ['Malayalam', 'ഭാഷ'],
    ['Telugu', 'భాష'],
    ['Bengali', 'ভাষা'],
  ])('covers %s', (_script, sample) => {
    expect(renderText(sample, {fontFamily: 'IBMPlexSerif-Regular'}).fontFamily).toBe(
      'sans-serif',
    );
  });

  it('leaves Latin text on the app font', () => {
    expect(
      renderText('App Language', {fontFamily: 'IBMPlexSerif-Regular'}).fontFamily,
    ).toBe('IBMPlexSerif-Regular');
  });

  it('detects Indic text among interpolated children', () => {
    expect(
      renderText(['Name: ', 'கமலா'], {fontFamily: 'IBMPlexSerif-Regular'})
        .fontFamily,
    ).toBe('sans-serif');
  });

  it('carries weight that lived in the font name', () => {
    expect(renderText('भाषा', {fontFamily: 'IBMPlexSerif-Medium'}).fontWeight).toBe(
      '500',
    );
  });

  it('carries slant that lived in the font name', () => {
    const style = renderText('भाषा', {fontFamily: 'ReplayPro-BoldItalic'});
    expect(style.fontWeight).toBe('bold');
    expect(style.fontStyle).toBe('italic');
  });

  it('does not override a weight the caller set', () => {
    expect(
      renderText('भाषा', {fontFamily: 'ReplayPro-Bold', fontWeight: '300'})
        .fontWeight,
    ).toBe('300');
  });

  it('keeps every other declared style', () => {
    const style = fontOf(
      render(
        <RealText
          testID="label"
          style={[
            {fontFamily: 'IBMPlexSerif-Regular', fontSize: 16},
            {color: '#111111'},
          ]}>
          भाषा
        </RealText>,
      ).getByTestId('label'),
    );

    expect(style.fontSize).toBe(16);
    expect(style.color).toBe('#111111');
    expect(style.fontFamily).toBe('sans-serif');
  });

  it('pins the platform font on a nested Text, which would inherit it otherwise', () => {
    const {getByTestId} = render(
      <RealText style={{fontFamily: 'IBMPlexSerif-Regular'}}>
        {'Name: '}
        <RealText testID="nested">கமலா</RealText>
      </RealText>,
    );

    expect(fontOf(getByTestId('nested')).fontFamily).toBe('sans-serif');
  });

  it.each([
    ['value', {value: 'ಭಾಷೆ'}],
    ['defaultValue', {defaultValue: 'ಭಾಷೆ'}],
    ['placeholder', {placeholder: 'ಭಾಷೆ'}],
  ])('applies to a TextInput whose %s is Indic', (_prop, props) => {
    expect(
      renderTextInput({style: {fontFamily: 'IBMPlexSerif-Regular'}, ...props})
        .fontFamily,
    ).toBe('sans-serif');
  });

  it('leaves a Latin TextInput alone', () => {
    expect(
      renderTextInput({
        style: {fontFamily: 'IBMPlexSerif-Regular'},
        placeholder: 'Add a note',
      }).fontFamily,
    ).toBe('IBMPlexSerif-Regular');
  });
});
