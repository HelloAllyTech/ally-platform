import React from 'react';
import {render} from '@testing-library/react-native';

import {SummaryGenerationProgress} from '../SummaryGenerationProgress';

jest.mock('lottie-react-native', () => 'LottieView');

jest.mock('@/assets', () => ({
  animations: {
    summaryLoading: require('@/assets/animations/summaryLoading.json'),
  },
  HexagonCloseIcon: () => null,
  ShieldWithTickIcon: () => null,
  summaryFailed: 1,
  summaryGenerated: 1,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    ShinyText: ({children}: any) => <Text>{children}</Text>,
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string, _?: any) => k}),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) => sel({ chat: { currentChat: {} }, summary: { summaryData: { details: { callDuration: 0 } } } }),
}));

jest.mock('@/utils/callSummary', () => ({
  getEstimatedSummaryGenerationTime: () => '1 min',
}));

jest.mock('@/constants', () => ({
  ChatSummaryStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED', NO_AUDIO: 'NO_AUDIO' },
  SUMMARY_GENERATION_STEPS: ['Step 1', 'Step 2', 'Step 3'],
  SummaryGenerationStep: { SEGREGATING_UTTERANCES: 'Step 2' },
}));

describe('CallSummaryScreen/SummaryGenerationProgress', () => {
  it('renders current generation step when not generated', () => {
    const {getByText} = render(<SummaryGenerationProgress />);
    expect(getByText('Step 1...')).toBeTruthy();
  });
});


