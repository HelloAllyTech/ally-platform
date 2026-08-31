import React from 'react';
import {render} from '@testing-library/react-native';

import {SimulationTranscriptItem} from '../SimulationTranscriptItem';

describe('SimulationTranscriptItem', () => {
  const defaultProps = {
    time: '00:01',
    message: 'Hello, this is a test message',
  };

  it('renders time and message correctly', () => {
    const {getByText} = render(
      <SimulationTranscriptItem {...defaultProps} speakerLabel="Speaker" />,
    );
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders speaker label when provided', () => {
    const {getByText} = render(
      <SimulationTranscriptItem {...defaultProps} speakerLabel="You" />,
    );
    expect(getByText('You')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('does not render speaker label when not provided', () => {
    const {queryByText, getByText} = render(
      <SimulationTranscriptItem {...defaultProps} />,
    );
    expect(queryByText(/You/)).toBeNull();
    // Message should still be rendered
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('shows active indicator when isActive is true', () => {
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="Speaker"
        isActive={true}
      />,
    );
    // Component should still render correctly when active
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders correctly without onPress prop', () => {
    const {getByText} = render(
      <SimulationTranscriptItem {...defaultProps} speakerLabel="Speaker" />,
    );
    // Component should render correctly even without onPress
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders correctly for learner messages', () => {
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="You"
        isLearner={true}
      />,
    );
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders correctly for AI client messages', () => {
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="AI Client"
        isLearner={false}
      />,
    );
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('AI Client')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders correctly with empty message', () => {
    const {getByText} = render(
      <SimulationTranscriptItem
        time="00:00"
        message=""
        speakerLabel="Speaker"
      />,
    );
    expect(getByText('00:00')).toBeTruthy();
    expect(getByText('Speaker')).toBeTruthy();
  });

  it('renders correctly with long message', () => {
    const longMessage = 'A'.repeat(200);
    const {getByText} = render(
      <SimulationTranscriptItem
        time="00:01"
        message={longMessage}
        speakerLabel="Speaker"
      />,
    );
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText(longMessage)).toBeTruthy();
  });

  // Annotations over the transcript were deprecated: the row renders the
  // speaker, the time and the message, and nothing else.
  it('renders a learner message', () => {
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="You"
        isLearner={true}
      />,
    );
    expect(getByText('You')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders an AI client message', () => {
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="AI Client"
        isLearner={false}
      />,
    );
    expect(getByText('AI Client')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

});
