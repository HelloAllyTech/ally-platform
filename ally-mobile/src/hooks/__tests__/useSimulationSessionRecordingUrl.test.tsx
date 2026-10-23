import React from 'react';
import {Text} from 'react-native';
import {render, waitFor} from '@testing-library/react-native';

const RECORDING_URL = 'https://example.com/recording.mp3';

// First attempt hits a transient error (e.g. a 500 or network blip); the
// recording genuinely exists and the second attempt succeeds.
const mockTrigger = jest
  .fn()
  .mockReturnValueOnce({unwrap: () => Promise.reject({status: 500})})
  .mockReturnValue({
    unwrap: () => Promise.resolve({presignedUrl: RECORDING_URL}),
  });

jest.mock('@/services/simulationTranscriptApi', () => ({
  useLazyGetSimulationSessionRecordingQuery: () => [mockTrigger],
}));

import {useSimulationSessionRecordingUrl} from '../useSimulationSessionRecordingUrl';

const Test = () => {
  const {url, isMissing, isInitialLoad} =
    useSimulationSessionRecordingUrl('session-1');
  return (
    <>
      <Text testID="url">{url ?? ''}</Text>
      <Text testID="isMissing">{String(isMissing)}</Text>
      <Text testID="isInitialLoad">{String(isInitialLoad)}</Text>
    </>
  );
};

describe('useSimulationSessionRecordingUrl', () => {
  it('recovers from a transient (non-404) error instead of permanently treating the recording as unavailable', async () => {
    const {getByTestId} = render(<Test />);

    await waitFor(() =>
      expect(getByTestId('isInitialLoad').props.children).toBe('false'),
    );

    // A transient error must not be reported as a confirmed-missing recording.
    expect(getByTestId('isMissing').props.children).toBe('false');
    // The retry should have recovered the actual recording URL.
    expect(getByTestId('url').props.children).toBe(RECORDING_URL);
  });
});
