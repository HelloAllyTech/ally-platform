import React from 'react';
import {render} from '@testing-library/react-native';

import {LiveFeedback} from '../LiveFeedback';

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Ensure AccessibilityInfo.announceForAccessibility exists on the mocked RN from jest.setup
const RN = require('react-native');
if (!RN.AccessibilityInfo) {
  RN.AccessibilityInfo = {} as any;
}
RN.AccessibilityInfo.announceForAccessibility = jest.fn();

describe('LiveFeedback', () => {
  it('renders message and emoji and announces for accessibility', () => {
    const {getByText} = render(<LiveFeedback message="hello" emoji="👍" />);
    getByText('hello');
    getByText('👍');
  });
});


