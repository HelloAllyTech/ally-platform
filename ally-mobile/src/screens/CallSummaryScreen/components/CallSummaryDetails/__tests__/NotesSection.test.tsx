jest.mock('@/hooks/useTranslate', () => {
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
  return {useTranslate: () => ({t: resolve, tVariable: resolve})};
});

import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {NotesSection} from '../NotesSection';

describe('NotesSection', () => {
  it('updates notes and submits on button press', () => {
    const onChange = jest.fn();
    const onSubmit = jest.fn();
    const {getByPlaceholderText, getByText} = render(
      <NotesSection notes="" onNotesChange={onChange} onSubmit={onSubmit} />,
    );

    fireEvent.changeText(
      getByPlaceholderText('Take notes for the next call (if any)'),
      'hello',
    );
    expect(onChange).toHaveBeenCalledWith('hello');

    fireEvent.press(getByText('Submit'));
    expect(onSubmit).toHaveBeenCalled();
  });
});


