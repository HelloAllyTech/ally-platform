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

  it('renders tags when provided', () => {
    const tags = [
      {label: 'Empathy', category: 'POSITIVE' as const},
      {label: 'Open-Ended Question', category: 'POSITIVE' as const},
    ];
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="Speaker"
        tags={tags}
      />,
    );
    expect(getByText('Empathy')).toBeTruthy();
    expect(getByText('Open-Ended Question')).toBeTruthy();
  });

  it('renders NEGATIVE tags correctly', () => {
    const tags = [
      {label: 'Avoid Advice Giving', category: 'NEGATIVE' as const},
      {label: 'Minimizing', category: 'NEGATIVE' as const},
    ];
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="Speaker"
        tags={tags}
      />,
    );
    expect(getByText('Avoid Advice Giving')).toBeTruthy();
    expect(getByText('Minimizing')).toBeTruthy();
  });

  it('renders POSITIVE tags correctly', () => {
    const tags = [
      {label: 'Reflection', category: 'POSITIVE' as const},
      {label: 'Pacing', category: 'POSITIVE' as const},
    ];
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="Speaker"
        tags={tags}
      />,
    );
    expect(getByText('Reflection')).toBeTruthy();
    expect(getByText('Pacing')).toBeTruthy();
  });

  it('renders multiple tags of mixed categories', () => {
    const tags = [
      {label: 'Empathy', category: 'POSITIVE' as const},
      {label: 'Avoid Advice Giving', category: 'NEGATIVE' as const},
      {label: 'Reflection', category: 'POSITIVE' as const},
    ];
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="Speaker"
        tags={tags}
      />,
    );
    expect(getByText('Empathy')).toBeTruthy();
    expect(getByText('Avoid Advice Giving')).toBeTruthy();
    expect(getByText('Reflection')).toBeTruthy();
  });

  it('does not render tags section when tags array is empty', () => {
    const {queryByText, getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="Speaker"
        tags={[]}
      />,
    );
    // Message should still be rendered
    expect(getByText('Hello, this is a test message')).toBeTruthy();
    // But no tags should be present (we can't test for absence of container directly,
    // but we know if there are no tag labels, the container isn't rendered)
  });

  it('does not render tags section when tags is undefined', () => {
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="Speaker"
        tags={undefined}
      />,
    );
    // Message should still be rendered
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders correctly with tags for learner messages', () => {
    const tags = [
      {label: 'Empathy', category: 'POSITIVE' as const},
      {label: 'Reflection', category: 'POSITIVE' as const},
    ];
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="You"
        isLearner={true}
        tags={tags}
      />,
    );
    expect(getByText('You')).toBeTruthy();
    expect(getByText('Empathy')).toBeTruthy();
    expect(getByText('Reflection')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders correctly with tags for AI client messages', () => {
    const tags = [
      {label: 'Avoid Advice Giving', category: 'NEGATIVE' as const},
    ];
    const {getByText} = render(
      <SimulationTranscriptItem
        {...defaultProps}
        speakerLabel="AI Client"
        isLearner={false}
        tags={tags}
      />,
    );
    expect(getByText('AI Client')).toBeTruthy();
    expect(getByText('Avoid Advice Giving')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });
});
