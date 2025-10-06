import React from 'react';
import {render, act} from '@testing-library/react-native';

import {useAudioLevel} from '../useAudioLevel';

jest.useFakeTimers();

jest.mock('livekit-client', () => ({
  ParticipantEvent: { IsSpeakingChanged: 'speaking' },
}));

function TestComp({participant}: any) {
  // trackRef shape: { participant, publication }
  const level = useAudioLevel({ participant });
  return null as any;
}

describe('useAudioLevel', () => {
  it('returns 0 when no participant', () => {
    render(<TestComp participant={undefined} />);
  });

  it('updates level when speaking and falls back/decays when not speaking', () => {
    const handlers: Record<string, any> = {};
    const participant: any = {
      isSpeaking: true,
      audioLevel: 0,
      on: (event: string, cb: any) => { handlers[event] = cb; },
      off: (event: string) => { delete handlers[event]; },
    };
    render(<TestComp participant={participant} />);

    // speaking true -> monitoring starts; advance time to update
    act(() => { jest.advanceTimersByTime(200); });

    // now simulate real audio level available
    participant.audioLevel = 0.8;
    act(() => { jest.advanceTimersByTime(100); });

    // switch to not speaking -> stop and decay
    act(() => { handlers['speaking'] && handlers['speaking'](false); });
    act(() => { jest.advanceTimersByTime(1200); });
  });
});



