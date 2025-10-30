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


