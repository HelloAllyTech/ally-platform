import React from 'react';
import {render} from '@testing-library/react-native';

import {MetricsSection} from '../MetricsSection';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) => sel({ summary: { visibleFields: ['LISTENING_RATIO','REFLECTIVE_QUESTIONS_ASKED','EMOTIONAL_LIFT'] } }),
}));

jest.mock('@/store/slices/summarySlice', () => ({
  selectSummaryVisibleFields: () => ['LISTENING_RATIO','REFLECTIVE_QUESTIONS_ASKED','EMOTIONAL_LIFT'],
}));

jest.mock('@/constants/summary', () => ({
  FIELD_LABELS: {
    LISTENING_RATIO: 'Listening Ratio',
    REFLECTIVE_QUESTIONS_ASKED: 'Reflective Questions Asked',
    EMOTIONAL_LIFT: 'Emotional Lift',
  },
  SUMMARY_FIELDS: {
    LISTENING_RATIO: 'LISTENING_RATIO',
    REFLECTIVE_QUESTIONS_ASKED: 'REFLECTIVE_QUESTIONS_ASKED',
    EMOTIONAL_LIFT: 'EMOTIONAL_LIFT',
  },
}));

describe('CallSummaryScreen/MetricsSection', () => {
  it('renders all metrics fields', () => {
    const {getByText} = render(
      <MetricsSection metrics={{ listeningShare: '0.5', reflectiveQuestionsAsked: 3, emotionalLift: 1 }} />,
    );
    expect(getByText('Listening Ratio:')).toBeTruthy();
    expect(getByText('50%')).toBeTruthy();
    expect(getByText('Reflective Questions Asked:')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('Emotional Lift:')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
  });
});


