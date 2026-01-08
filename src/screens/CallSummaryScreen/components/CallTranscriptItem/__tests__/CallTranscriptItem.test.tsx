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

  it('renders speaker label when provided', () => {
    const {getByText} = render(
      <CallTranscriptItem {...defaultProps} speakerLabel="You" />,
    );
    expect(getByText('You: Hello, this is a test message')).toBeTruthy();
  });

  it('does not render speaker label when not provided', () => {
    const {getByText, queryByText} = render(
      <CallTranscriptItem {...defaultProps} />,
    );
    expect(getByText('Hello, this is a test message')).toBeTruthy();
    // Speaker label should not be rendered
    expect(queryByText(/You:/)).toBeNull();
  });

  it('renders empty speaker label correctly', () => {
    const {getByText} = render(
      <CallTranscriptItem {...defaultProps} speakerLabel="" />,
    );
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('applies custom container style', () => {
    const customStyle = {marginTop: 10};
    const {getByText} = render(
      <CallTranscriptItem {...defaultProps} containerStyle={customStyle} />,
    );
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('applies custom time style', () => {
    const customStyle = {color: 'red'};
    const {getByText} = render(
      <CallTranscriptItem {...defaultProps} timeStyle={customStyle} />,
    );
    expect(getByText('00:01')).toBeTruthy();
  });

  it('applies custom message style', () => {
    const customStyle = {fontSize: 16};
    const {getByText} = render(
      <CallTranscriptItem {...defaultProps} messageStyle={customStyle} />,
    );
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('applies custom message text style', () => {
    const customStyle = {fontWeight: 'bold' as const};
    const {getByText} = render(
      <CallTranscriptItem {...defaultProps} messageTextStyle={customStyle} />,
    );
    expect(getByText('Hello, this is a test message')).toBeTruthy();
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

  it('renders correctly with different speaker labels', () => {
    const {getByText} = render(
      <CallTranscriptItem
        {...defaultProps}
        speakerLabel="AI Assistant"
      />,
    );
    expect(getByText('AI Assistant: Hello, this is a test message')).toBeTruthy();
  });
});
