import React from 'react';
import {Text, View} from 'react-native';
import {render} from '@testing-library/react-native';

import {AndroidCommentableText} from '../AndroidCommentableText';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

describe('AndroidCommentableText', () => {
  it('renders children in fallback View on non-android platform', () => {
    const {getByText} = render(
      <AndroidCommentableText messageId="msg-1">
        <Text>Child content</Text>
      </AndroidCommentableText>,
    );

    expect(getByText('Child content')).toBeTruthy();
  });

  it('passes style to fallback View', () => {
    const {UNSAFE_root} = render(
      <AndroidCommentableText messageId="msg-1" style={{marginTop: 42}}>
        <Text>Styled child</Text>
      </AndroidCommentableText>,
    );

    const views = UNSAFE_root.findAllByType(View as any);
    const withMargin = views.find((v: {props: {style?: unknown}}) => {
      const s = v.props.style;
      if (Array.isArray(s)) {
        return s.some(
          (item: {marginTop?: number}) => item?.marginTop === 42,
        );
      }
      return (s as {marginTop?: number} | undefined)?.marginTop === 42;
    });
    expect(withMargin).toBeTruthy();
  });

  it('renders without crashing with minimal props', () => {
    const {toJSON} = render(
      <AndroidCommentableText messageId="minimal-id" />,
    );

    expect(toJSON()).toBeTruthy();
  });
});
