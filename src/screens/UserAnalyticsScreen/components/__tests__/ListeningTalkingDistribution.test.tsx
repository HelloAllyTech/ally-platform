import React from 'react';
import {render} from '@testing-library/react-native';

import {ListeningTalkingDistribution} from '../ListeningTalkingDistribution';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
}));

describe('ListeningTalkingDistribution', () => {
  it('renders title when isLoading is true', () => {
    const {getByText} = render(<ListeningTalkingDistribution isLoading stats={{}} />);
    expect(getByText('analytics.listeningTalking.title')).toBeTruthy();
  });

  it('renders no data message when both percents are 0', () => {
    const {getByText} = render(
      <ListeningTalkingDistribution stats={{listeningPercent: 0, talkingPercent: 0}} />,
    );
    expect(getByText('analytics.listeningTalking.noData')).toBeTruthy();
  });

  it('renders listening bar and percentage when listeningPercent > 0', () => {
    const {getByText} = render(
      <ListeningTalkingDistribution stats={{listeningPercent: 25, talkingPercent: 0}} />,
    );
    expect(getByText('25.00%')).toBeTruthy();
  });

  it('renders talking bar and percentage when talkingPercent > 0', () => {
    const {getByText} = render(
      <ListeningTalkingDistribution stats={{listeningPercent: 0, talkingPercent: 75}} />,
    );
    expect(getByText('75.00%')).toBeTruthy();
  });
});


