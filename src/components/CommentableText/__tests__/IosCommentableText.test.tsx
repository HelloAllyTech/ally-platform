import React from 'react';
import {act, render} from '@testing-library/react-native';

import type {MessagePart} from '@/types/reviews';

import {IosCommentableText} from '../IosCommentableText';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const ReactNative = require('react');
  const NativeStub = ReactNative.forwardRef(
    (props: Record<string, unknown>, ref: unknown) =>
      ReactNative.createElement(RN.View, {
        ref,
        testID: 'CommentableTextView',
        ...props,
      }),
  );
  NativeStub.displayName = 'CommentableTextView';
  RN.requireNativeComponent = jest.fn(() => NativeStub);
  return RN;
});

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: Record<string, unknown>) => s},
}));

jest.mock('@/theme', () => ({
  colors: {
    black: '#000',
    ds: {
      surface: {background: '#fff'},
      typography: {lowEmphasis: '#999', highEmphasis: '#111'},
    },
  },
  fontFamily: {
    IBM_PLEX_SERIF: {
      REGULAR: {fontFamily: 'IBM Plex Serif'},
      MEDIUM: {fontFamily: 'IBM Plex Serif Medium'},
    },
  },
  typography: {
    body: {
      medium: {fontSize: 16},
      small: {fontSize: 14},
    },
  },
}));

const basePart = (text: string): MessagePart => ({
  text,
  commentIds: [],
  start: 0,
  end: text.length,
});

function renderIos(ui: React.ReactElement) {
  const result = render(ui);
  act(() => {
    jest.runOnlyPendingTimers();
  });
  return result;
}

describe('IosCommentableText', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders without crashing with minimal props (messageId, value)', () => {
    const {toJSON, UNSAFE_root} = renderIos(
      <IosCommentableText messageId="m1" value="hello" />,
    );

    expect(toJSON()).toBeTruthy();
    const native = UNSAFE_root.findAllByProps({text: 'hello'});
    expect(native.length).toBeGreaterThan(0);
  });

  it('renders placeholder when displayText is empty and placeholder is provided', () => {
    const {getByText, UNSAFE_root} = renderIos(
      <IosCommentableText
        messageId="m2"
        placeholder="Type something"
        onShowAddCommentMenu={() => {}}
      />,
    );

    expect(getByText('Type something')).toBeTruthy();
    const native = UNSAFE_root.findAllByProps({text: ''});
    expect(native.length).toBeGreaterThan(0);
  });

  it('computes displayText from parts when parts are provided', () => {
    const parts: MessagePart[] = [
      basePart('hello'),
      basePart('world'),
    ];

    const {UNSAFE_root} = renderIos(
      <IosCommentableText
        messageId="m3"
        parts={parts}
        separator="-"
        onShowAddCommentMenu={() => {}}
      />,
    );

    const native = UNSAFE_root.findAllByProps({text: 'hello-world'});
    expect(native.length).toBeGreaterThan(0);
  });
});
