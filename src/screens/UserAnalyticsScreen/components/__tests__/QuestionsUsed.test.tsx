import React from 'react';
import {render} from '@testing-library/react-native';

import {QuestionsUsed} from '../QuestionsUsed';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
}));

describe('QuestionsUsed', () => {
  it('renders title and description translation keys', () => {
    const {getByText} = render(<QuestionsUsed />);

    expect(getByText('analytics.questions.title')).toBeTruthy();
    expect(getByText('analytics.questions.description')).toBeTruthy();
  });

  it('renders numbers used and total', () => {
    const {getByText} = render(<QuestionsUsed />);

    // component hardcodes "8/10" concatenation
    expect(getByText('8/10')).toBeTruthy();
  });
});


