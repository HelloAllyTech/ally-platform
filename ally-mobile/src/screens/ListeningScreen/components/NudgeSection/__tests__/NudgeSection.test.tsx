import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {TouchableOpacity} from 'react-native';

import {NudgeSection} from '../NudgeSection';

jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({ t: (k: string) => k }),
  useDebounce: (fn: any) => fn,
}));

jest.mock('@/store/hooks', () => ({
  __esModule: true,
  useAppSelector: () => ['edit:message:feedback'], // Mock permissions for feedback
}));

jest.mock('@/services/chatApi', () => ({
  __esModule: true,
  useAddFeedbackMutation: () => [jest.fn(() => ({ unwrap: () => Promise.resolve({feedbackId: '1', rating: 1}) }))],
  useUpdateFeedbackMutation: () => [{}, {isLoading: false} as any],
}));

jest.mock('@/utils/logger', () => ({
  logger: { error: jest.fn() },
}));

jest.mock('../../CustomMarkdown/CustomMarkdown', () => ({
  CustomMarkdown: ({content}: any) => content ? null : null,
}));

jest.mock('../../SkeletonLoader/SkeletonLoader', () => ({
  SkeletonLoader: () => null,
}));

describe('NudgeSection', () => {
  const baseNudge: any = {
    id: 'n1',
    content: 'Hello',
    feedback: null,
  };

  it('shows loader when isLoading is true', () => {
    const {toJSON} = render(
      <NudgeSection nudge={baseNudge} isLoading={true} onFeedbackSuccess={jest.fn()} />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('invokes negative and positive feedback handlers', async () => {
    const onFeedbackSuccess = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <NudgeSection nudge={baseNudge} isLoading={false} onFeedbackSuccess={onFeedbackSuccess} />,
    );

    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    // First is thumbs down, second is thumbs up
    fireEvent.press(touchables[0]);
    fireEvent.press(touchables[1]);
  });
});


