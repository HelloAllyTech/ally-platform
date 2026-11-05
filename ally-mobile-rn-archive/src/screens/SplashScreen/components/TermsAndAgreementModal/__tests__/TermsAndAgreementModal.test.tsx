import React from 'react';
import {Linking} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {TermsAndAgreementModal} from '../TermsAndAgreementModal';
import {TermsAndAgreementData} from '@/constants';

// Mock useTranslate
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

// Mock Checkbox and Button
jest.mock('@/components', () => {
  const React = require('react');
  const {TouchableOpacity, Text} = require('react-native');
  return {
    Checkbox: ({checked, onPress}: any) => (
      <TouchableOpacity onPress={onPress} testID="mock-checkbox">
        <Text>{checked ? 'Checked' : 'Unchecked'}</Text>
      </TouchableOpacity>
    ),
    Button: ({label, onPress, isDisabled, isLoading}: any) => (
      <TouchableOpacity
        onPress={onPress}
        testID="mock-primary-button"
        accessibilityState={{disabled: isDisabled || isLoading}}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

// Mock Linking
jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));

describe('TermsAndAgreementModal', () => {
  const mockOnAgree = jest.fn();

  beforeEach(() => {
    mockOnAgree.mockClear();
    jest.clearAllMocks();
  });

  it('renders correctly when visible', () => {
    const {getByText, getByTestId} = render(
      <TermsAndAgreementModal visible={true} onAgree={mockOnAgree} />,
    );

    expect(getByText('terms.title')).toBeTruthy();
    expect(getByTestId('terms-scroll-view')).toBeTruthy();
    expect(getByText('terms.scrollToBottom')).toBeTruthy();
  });

  it('renders terms content', () => {
    const {getByText} = render(
      <TermsAndAgreementModal visible={true} onAgree={mockOnAgree} />,
    );

    TermsAndAgreementData.forEach((section) => {
      expect(getByText(section.headingKey)).toBeTruthy();
    });
  });

  it('switches to agreement view when scroll to bottom is pressed', () => {
    const {getByText, getByTestId, queryByText} = render(
      <TermsAndAgreementModal visible={true} onAgree={mockOnAgree} />,
    );

    fireEvent.press(getByTestId('scroll-to-bottom-button'));

    expect(queryByText('terms.scrollToBottom')).toBeNull();
    // completeDetails text is always rendered in ScrollView, check if it contains the key
    expect(getByText(/terms\.footerPrefix/)).toBeTruthy();
    expect(getByText('terms.agreeLabel')).toBeTruthy();
    expect(getByTestId('mock-primary-button')).toBeTruthy();
  });

  it('enables agree button only when checked', () => {
    const {getByTestId} = render(
      <TermsAndAgreementModal visible={true} onAgree={mockOnAgree} />,
    );

    // Scroll to bottom first
    fireEvent.press(getByTestId('scroll-to-bottom-button'));

    const checkbox = getByTestId('agree-checkbox-container');
    const button = getByTestId('mock-primary-button');

    // Initially unchecked and disabled
    expect(button.props.accessibilityState.disabled).toBe(true);

    // Check
    fireEvent.press(checkbox);
    expect(button.props.accessibilityState.disabled).toBeFalsy();

    // Uncheck
    fireEvent.press(checkbox);
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  it('calls onAgree when agree button is pressed', () => {
    const {getByTestId} = render(
      <TermsAndAgreementModal visible={true} onAgree={mockOnAgree} />,
    );

    // Scroll to bottom
    fireEvent.press(getByTestId('scroll-to-bottom-button'));

    // Check
    fireEvent.press(getByTestId('agree-checkbox-container'));

    // Press Agree
    fireEvent.press(getByTestId('mock-primary-button'));

    expect(mockOnAgree).toHaveBeenCalledTimes(1);
  });

  it('opens link when link text is pressed', () => {
    const {getByText} = render(
      <TermsAndAgreementModal visible={true} onAgree={mockOnAgree} />,
    );

    // Find a section with a bullet that has a link
    const sectionWithLink = TermsAndAgreementData.find(section =>
      section.bullets.some(bullet => bullet.link),
    );
    if (sectionWithLink) {
      const bulletWithLink = sectionWithLink.bullets.find(bullet => bullet.link);
      if (bulletWithLink && bulletWithLink.link) {
        const linkText = getByText(bulletWithLink.link.textKey);
        fireEvent.press(linkText);
        expect(Linking.openURL).toHaveBeenCalledWith(bulletWithLink.link.href);
      }
    }
  });

  it('handles scroll event to detect bottom', () => {
    const {getByTestId, getByText} = render(
        <TermsAndAgreementModal visible={true} onAgree={mockOnAgree} />,
      );

      const scrollView = getByTestId('terms-scroll-view');

      // Simulate scrolling to bottom
      fireEvent.scroll(scrollView, {
        nativeEvent: {
            contentOffset: { y: 100 },
            layoutMeasurement: { height: 100 },
            contentSize: { height: 200 },
        },
      });

      expect(
        getByText('terms.agreeLabel'),
      ).toBeTruthy();
  });
});
