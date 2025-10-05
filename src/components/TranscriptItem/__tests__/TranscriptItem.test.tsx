import React from 'react';
import {render} from '@testing-library/react-native';

import {TranscriptItem} from '@/components/TranscriptItem';

describe('TranscriptItem', () => {
  it('renders time and message', () => {
    const {getByText} = render(
      <TranscriptItem time="10:00" message="Hello" />,
    );
    expect(getByText('10:00')).toBeTruthy();
    expect(getByText('Hello')).toBeTruthy();
  });

  it('renders speaker label prefix when provided', () => {
    const {getByText} = render(
      <TranscriptItem time="10:01" message="Hi" speakerLabel="You" />,
    );
    // The label is concatenated with a colon and a space
    expect(getByText(/You:\s*/)).toBeTruthy();
    expect(getByText('Hi')).toBeTruthy();
  });
});
