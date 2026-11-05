import React from 'react';
import {render} from '@testing-library/react-native';

import {EmptyTranscript} from '@/components/EmptyTranscript';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/assets/icons', () => ({
  EmptyTranscriptIcon: () => null,
}));

describe('EmptyTranscript', () => {
  it('renders translated empty text', () => {
    const {getByText} = render(<EmptyTranscript />);
    expect(getByText('transcription.empty')).toBeTruthy();
  });
});
