import React from 'react';
import {render} from '@testing-library/react-native';

import {CallTranscriptItem} from '../CallTranscriptItem';

describe('CallTranscriptItem', () => {
  const defaultProps = {
    time: '00:01',
    message: 'Hello, this is a test message',
  };

  it('renders time and message correctly', () => {
    const {getByText} = render(<CallTranscriptItem {...defaultProps} />);
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders speaker label as separate element when provided', () => {
    const {getByText} = render(
      <CallTranscriptItem {...defaultProps} speakerLabel="You" />,
    );
    expect(getByText('You')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('does not render speaker label when not provided', () => {
    const {getByText, queryByText} = render(
      <CallTranscriptItem {...defaultProps} />,
    );
    expect(getByText('Hello, this is a test message')).toBeTruthy();
    expect(queryByText(/You/)).toBeNull();
  });

  it('renders correctly with empty message', () => {
    const {getByText} = render(
      <CallTranscriptItem time="00:00" message="" />,
    );
    expect(getByText('00:00')).toBeTruthy();
  });

  it('renders correctly with long message', () => {
    const longMessage = 'A'.repeat(200);
    const {getByText} = render(
      <CallTranscriptItem time="00:01" message={longMessage} />,
    );
    expect(getByText(longMessage)).toBeTruthy();
  });

  it('renders counselor and client items', () => {
    const {getByText: getByTextCounselor} = render(
      <CallTranscriptItem {...defaultProps} counselor speakerLabel="You" />,
    );
    expect(getByTextCounselor('You')).toBeTruthy();

    const {getByText: getByTextClient} = render(
      <CallTranscriptItem {...defaultProps} counselor={false} speakerLabel="Client" />,
    );
    expect(getByTextClient('Client')).toBeTruthy();
  });
});
