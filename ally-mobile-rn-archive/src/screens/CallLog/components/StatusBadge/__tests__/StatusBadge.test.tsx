import React from 'react';
import {render} from '@testing-library/react-native';

import {StatusBadge} from '@/screens/CallLog/components/StatusBadge/StatusBadge';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/assets', () => ({ HexagonCloseIcon: () => null }));

jest.mock('@/constants', () => ({
  ChatSummaryStatus: { NO_AUDIO: 'NO_AUDIO', DONE: 'DONE' },
  SUMMARY_STATUS_CONFIG: {
    DONE: { backgroundColor: '#eee', dotColor: '#111', label: 'done' },
  },
}));

describe('StatusBadge', () => {
  it('renders no-audio variant', () => {
    const {getByText} = render(
      <StatusBadge status={(require('@/constants').ChatSummaryStatus as any).NO_AUDIO} />,
    );
    expect(getByText('calls.status.noAudio')).toBeTruthy();
  });

  it('renders configured status label', () => {
    const {getByText} = render(
      <StatusBadge status={(require('@/constants').ChatSummaryStatus as any).DONE} />,
    );
    expect(getByText('done')).toBeTruthy();
  });
});
