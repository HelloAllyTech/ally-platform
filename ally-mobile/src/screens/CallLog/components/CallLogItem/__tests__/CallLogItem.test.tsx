import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {TouchableOpacity, Text} from 'react-native';

import {CallLogItem} from '@/screens/CallLog/components/CallLogItem/CallLogItem';

jest.mock('@/assets/icons', () => ({
  DoubleBottomArrowIcon: () => null,
  DoubleRightArrowIcon: () => null,
  EyeIcon: () => null,
}));

jest.mock('@/hooks', () => ({ useTranslate: () => ({ t: (k: string) => k }) }));

jest.mock('@/constants', () => ({
  DEFAULT_HIT_SLOP: {},
  LogType: { REAL: 'REAL', SIMULATION: 'SIMULATION' },
  TAG_COLORS: {
    1: { bg: '#111', text: '#fff' },
    2: { bg: '#222', text: '#fff' },
    3: { bg: '#333', text: '#fff' },
    4: { bg: '#444', text: '#fff' },
    5: { bg: '#555', text: '#fff' },
  },
  formatSessionMode: (value: unknown, t: (k: string) => string) => {
    if (!value) return '-';
    return value.toString().toUpperCase() === 'DICTATION'
      ? t('calls.mode.dictation')
      : t('calls.mode.scribe');
  },
}));

jest.mock('@/utils/date', () => ({
  formatDate: () => '2024-01-01',
  formatTime: () => '10:00',
  calculateDuration: () => '5m',
}));

jest.mock('@/screens/CallLog/components/StatusBadge', () => ({
  StatusBadge: () => null,
}));

jest.mock('@/screens/CallLog/components/Tag/Tag', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Tag: ({label}: any) => React.createElement(Text, null, label),
  };
});

describe('CallLogItem', () => {
  const baseItem: any = {
    id: '1',
    startedAt: '2024-01-01T10:00:00Z',
    endedAt: '2024-01-01T10:05:00Z',
    details: { chatId: 'chat-1', summary: { tags: [{ tag: 'help', positivity_rating: 5 }] } },
  };

  it('renders title and date/time for REAL logs', () => {
    const {getByText} = render(
      <CallLogItem
        item={baseItem}
        expanded={false}
        logType={(require('@/constants').LogType as any).REAL}
        onToggle={jest.fn()}
        onItemPress={jest.fn()}
      />,
    );

    expect(getByText('chat-1')).toBeTruthy();
    expect(getByText('2024-01-01 • 10:00')).toBeTruthy();
  });

  it('calls onItemPress when pressed, and onToggle when arrow pressed', () => {
    const onItemPress = jest.fn();
    const onToggle = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <CallLogItem
        item={baseItem}
        expanded={false}
        logType={(require('@/constants').LogType as any).REAL}
        onToggle={onToggle}
        onItemPress={onItemPress}
      />,
    );

    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]);
    expect(onItemPress).toHaveBeenCalled();

    if (touchables[1]) {
      fireEvent.press(touchables[1]);
      expect(onToggle).toHaveBeenCalled();
    }
  });

  it('shows expanded duration and tags when expanded', () => {
    const {getByText} = render(
      <CallLogItem
        item={baseItem}
        expanded={true}
        logType={(require('@/constants').LogType as any).REAL}
        onToggle={jest.fn()}
        onItemPress={jest.fn()}
      />,
    );

    expect(getByText('common.duration: 5m')).toBeTruthy();
    expect(getByText('help')).toBeTruthy();
  });

  it('renders tags without crashing for out-of-range or fractional positivity_rating', () => {
    // Regression: the AI can emit ratings outside the integer 1-5 range (e.g.
    // 0.3), which are not keys in TAG_COLORS. Reading .bg on the undefined
    // lookup used to crash the whole screen.
    const oddRatingsItem: any = {
      ...baseItem,
      details: {
        ...baseItem.details,
        summary: {
          tags: [
            { tag: 'fractional', positivity_rating: 0.3 },
            { tag: 'zero', positivity_rating: 0 },
            { tag: 'too-high', positivity_rating: 7 },
            { tag: 'missing' }, // positivity_rating undefined
          ],
        },
      },
    };

    const {getByText} = render(
      <CallLogItem
        item={oddRatingsItem}
        expanded={true}
        logType={(require('@/constants').LogType as any).REAL}
        onToggle={jest.fn()}
        onItemPress={jest.fn()}
      />,
    );

    expect(getByText('fractional')).toBeTruthy();
    expect(getByText('zero')).toBeTruthy();
    expect(getByText('too-high')).toBeTruthy();
    expect(getByText('missing')).toBeTruthy();
  });

  it('shows "Mode: Scribe" when expanded and mode is SCRIBE', () => {
    const scribeItem: any = {
      ...baseItem,
      details: {
        ...baseItem.details,
        callInfo: { summaryName: 'Test', mode: 'SCRIBE' },
      },
    };
    const {getByText} = render(
      <CallLogItem
        item={scribeItem}
        expanded={true}
        logType={(require('@/constants').LogType as any).REAL}
        onToggle={jest.fn()}
        onItemPress={jest.fn()}
      />,
    );

    expect(getByText(/calls.mode.scribe/)).toBeTruthy();
  });

  it('shows "Mode: Dictation" when expanded and mode is DICTATION', () => {
    const dictationItem: any = {
      ...baseItem,
      details: {
        ...baseItem.details,
        callInfo: { summaryName: 'Test', mode: 'DICTATION' },
      },
    };
    const {getByText} = render(
      <CallLogItem
        item={dictationItem}
        expanded={true}
        logType={(require('@/constants').LogType as any).REAL}
        onToggle={jest.fn()}
        onItemPress={jest.fn()}
      />,
    );

    expect(getByText(/calls.mode.dictation/)).toBeTruthy();
  });
});
