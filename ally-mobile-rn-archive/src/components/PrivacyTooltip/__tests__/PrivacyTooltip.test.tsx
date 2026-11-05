import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {Text} from 'react-native';

import {PrivacyTooltip} from '@/components/PrivacyTooltip';

// Mock third-party tooltip to a simple passthrough component that renders children when visible
jest.mock('react-native-walkthrough-tooltip', () => {
  const React = require('react');
  return ({isVisible, content, children}: any) => (
    <>
      {children}
      {isVisible ? <>{content}</> : null}
    </>
  );
});

describe('PrivacyTooltip', () => {
  it('renders children and toggles content visibility', () => {
    const onClose = jest.fn();
    const {queryByText, rerender, getByText} = render(
      <PrivacyTooltip
        isVisible={false}
        onClose={onClose}
        tooltipContent={<Text>content</Text>}>
        <Text>child</Text>
      </PrivacyTooltip>,
    );

    expect(getByText('child')).toBeTruthy();
    expect(queryByText('content')).toBeNull();

    rerender(
      <PrivacyTooltip
        isVisible={true}
        onClose={onClose}
        tooltipContent={<Text>content</Text>}>
        <Text>child</Text>
      </PrivacyTooltip>,
    );

    expect(getByText('content')).toBeTruthy();
  });
});
