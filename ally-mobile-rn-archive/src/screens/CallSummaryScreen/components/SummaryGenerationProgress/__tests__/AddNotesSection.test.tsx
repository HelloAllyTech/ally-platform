jest.mock('react-i18next', () => {
  const en = require('@/localization/locales/en.json');
  const resolve = (key, vars = {}) => {
    const val = String(key)
      .split('.')
      .reduce((o, p) => (o == null ? undefined : o[p]), en);
    let s = typeof val === 'string' ? val : key;
    Object.keys(vars || {}).forEach(k => {
      s = s.split('{{' + k + '}}').join(String(vars[k]));
    });
    return s;
  };
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      t: resolve,
      i18n: {language: 'en', changeLanguage: jest.fn()},
    }),
  };
});

import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {AddNotesSection} from '../AddNotesSection';

jest.mock('@/assets', () => ({
  ArrowDown: () => null,
  PageIcon: () => null,
  InfoIcon: () => null,
}));

jest.mock('@/components', () => ({
  PrivacyTooltip: ({children}: any) => <>{children}</>,
}));

describe('CallSummaryScreen/AddNotesSection', () => {
  it('toggles expansion and updates text', () => {
    const onNoteChange = jest.fn();
    const {getByText, getByPlaceholderText} = render(
      <AddNotesSection savedNotes="hello" onNoteChange={onNoteChange} />,
    );

    fireEvent.press(getByText('Add Notes (optional)'));
    const input = getByPlaceholderText('Enter note');
    fireEvent.changeText(input, 'updated');
    expect(onNoteChange).toHaveBeenCalledWith('updated');
  });
});


