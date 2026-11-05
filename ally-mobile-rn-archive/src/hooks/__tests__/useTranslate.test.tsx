import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {useTranslate} from '../useTranslate';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string, _?: any) => k}),
}));

const TestComponent = () => {
  const {t, tVariable} = useTranslate();
  return (
    <>
      <Text>{t('common.ok')}</Text>
      <Text>{tVariable('common.cancel')}</Text>
    </>
  );
};

describe('useTranslate', () => {
  it('returns translation functions that pass through keys in tests', () => {
    const {getByText} = render(<TestComponent />);
    expect(getByText('common.ok')).toBeTruthy();
    expect(getByText('common.cancel')).toBeTruthy();
  });
});


