import {act, renderHook} from '@testing-library/react-native';

jest.mock('livekit-client', () => ({
  ParticipantEvent: {IsSpeakingChanged: 'isSpeakingChanged'},
}));

import type {RemoteParticipant} from 'livekit-client';

import {useAudioLevel} from '../useAudioLevel';

/**
 * A stand-in for the four members `useAudioLevel` actually touches:
 * `audioLevel`, `isSpeaking`, `on` and `off`. `RemoteParticipant` carries
 * 50-odd more, none of which a unit test has any business constructing, so
 * the object is asserted into the type rather than built up to it.
 *
 * The intersection with the literal shape is what keeps `on`/`off` visible as
 * jest mocks (so `toHaveBeenCalledWith` still type-checks) and keeps `emit`,
 * which is the test's own hook for driving the listener — it is not part of
 * LiveKit's participant surface.
 *
 * The `import type` above is erased at compile time, so it does not defeat
 * the `jest.mock('livekit-client')` at the top of this file.
 */
const createMockParticipant = (overrides: Record<string, unknown> = {}) => {
  const listeners = new Map<string, Set<Function>>();
  const mock = {
    audioLevel: 0,
    isSpeaking: false,
    on: jest.fn((event: string, cb: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    }),
    off: jest.fn((event: string, cb: Function) => {
      listeners.get(event)?.delete(cb);
    }),
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach(cb => cb(...args));
    },
    ...overrides,
  };
  return mock as unknown as RemoteParticipant & typeof mock;
};

describe('useAudioLevel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 0 when no participant is provided', () => {
    const {result} = renderHook(() => useAudioLevel({participant: undefined}));
    expect(result.current).toBe(0);
  });

  it('registers a listener for IsSpeakingChanged', () => {
    const participant = createMockParticipant();
    renderHook(() => useAudioLevel({participant}));
    expect(participant.on).toHaveBeenCalledWith(
      'isSpeakingChanged',
      expect.any(Function),
    );
  });

  it('starts monitoring and sets a non-zero level when participant starts speaking', () => {
    const participant = createMockParticipant({audioLevel: 0.5});
    const {result} = renderHook(() => useAudioLevel({participant}));

    act(() => {
      participant.emit('isSpeakingChanged', true);
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBeGreaterThan(0);
  });

  it('uses minimum level of 0.1 when audioLevel is 0 but speaking', () => {
    const participant = createMockParticipant({audioLevel: 0, isSpeaking: false});
    const {result} = renderHook(() => useAudioLevel({participant}));

    act(() => {
      participant.emit('isSpeakingChanged', true);
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBe(0.1);
  });

  it('caps audio level to 1', () => {
    const participant = createMockParticipant({audioLevel: 1.5});
    const {result} = renderHook(() => useAudioLevel({participant}));

    act(() => {
      participant.emit('isSpeakingChanged', true);
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBeLessThanOrEqual(1);
  });

  it('resets to 0 when participant stops speaking', () => {
    const participant = createMockParticipant({audioLevel: 0.5});
    const {result} = renderHook(() => useAudioLevel({participant}));

    act(() => {
      participant.emit('isSpeakingChanged', true);
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBeGreaterThan(0);

    act(() => {
      participant.emit('isSpeakingChanged', false);
    });

    expect(result.current).toBe(0);
  });

  it('unregisters listener and clears interval on unmount', () => {
    const participant = createMockParticipant();
    const {unmount} = renderHook(() => useAudioLevel({participant}));

    unmount();

    expect(participant.off).toHaveBeenCalledWith(
      'isSpeakingChanged',
      expect.any(Function),
    );
  });

  it('starts monitoring immediately if participant is already speaking', () => {
    const participant = createMockParticipant({
      isSpeaking: true,
      audioLevel: 0.7,
    });
    const {result} = renderHook(() => useAudioLevel({participant}));

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBeGreaterThan(0);
  });

  it('starts monitoring if participant has non-zero audio level even if not marked as speaking', () => {
    const participant = createMockParticipant({
      isSpeaking: false,
      audioLevel: 0.3,
    });
    const {result} = renderHook(() => useAudioLevel({participant}));

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBeGreaterThan(0);
  });
});
