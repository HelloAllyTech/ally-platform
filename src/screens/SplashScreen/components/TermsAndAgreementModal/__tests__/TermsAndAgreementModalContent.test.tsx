// Deliberately does NOT stub t() as an identity function, unlike the sibling
// TermsAndAgreementModal.test.tsx — this suite resolves keys against the real
// bundled en.json resource (same pattern as BoxBreathingAnimation.test.tsx),
// so a translation key missing from the locale file shows up as a failure
// instead of being masked by echoing the key back.
jest.mock('@/hooks', () => {
  const en = require('@/localization/locales/en.json');
  const resolve = (key: string) => {
    const val = String(key)
      .split('.')
      .reduce((o: any, p: string) => (o == null ? undefined : o[p]), en);
    return typeof val === 'string' ? val : key;
  };
  return {useTranslate: () => ({t: resolve, tVariable: resolve})};
});

import React from 'react';
import {Linking} from 'react-native';
import {render} from '@testing-library/react-native';

import {TermsAndAgreementModal} from '../TermsAndAgreementModal';
import {TermsAndAgreementData} from '@/constants';

// Mock Checkbox and Button
jest.mock('@/components', () => {
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

jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));

describe('TermsAndAgreementModal real translations', () => {
  it('renders the emergency-services link as the crisis-help URL, not the raw i18n key', () => {
    const {getByText, queryByText} = render(
      <TermsAndAgreementModal visible={true} onAgree={jest.fn()} />,
    );

    const sectionWithLink = TermsAndAgreementData.find(section =>
      section.bullets.some(bullet => bullet.link),
    );
    const bulletWithLink = sectionWithLink?.bullets.find(
      bullet => bullet.link,
    );
    const link = bulletWithLink?.link;
    if (!link) {
      throw new Error('expected fixture data to include a link bullet');
    }

    // The bug: t() falls back to returning the key itself when the key is
    // missing from en.json, so the link renders literally as
    // 'TermsAndAgreement.sections.generalTerms.bullets.crisisLink'.
    expect(queryByText(link.textKey)).toBeNull();
    expect(getByText('https://findahelpline.com/')).toBeTruthy();
  });
});
