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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('CallSummaryScreen/AddNotesSection', () => {
  it('toggles expansion and updates text', () => {
    const onNoteChange = jest.fn();
    const {getByText, getByPlaceholderText} = render(
      <AddNotesSection savedNotes="hello" onNoteChange={onNoteChange} />,
    );

    fireEvent.press(getByText('summaryLoading.addNotes'));
    const input = getByPlaceholderText('Enter note');
    fireEvent.changeText(input, 'updated');
    expect(onNoteChange).toHaveBeenCalledWith('updated');
  });
});


