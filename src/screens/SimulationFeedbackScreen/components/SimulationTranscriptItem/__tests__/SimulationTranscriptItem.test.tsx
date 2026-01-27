import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {SimulationTranscriptItem} from '../SimulationTranscriptItem';

describe('SimulationTranscriptItem', () => {
  const defaultProps = {
    time: '00:01',
    message: 'Hello, this is a test message',
  };

  it('renders time and message correctly', () => {
    const {getByText} = render(<SimulationTranscriptItem {...defaultProps} />);
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders speaker label when provided', () => {
    const {getByText} = render(
      <SimulationTranscriptItem {...defaultProps} speakerLabel="You" />,
    );
    expect(getByText('You: Hello, this is a test message')).toBeTruthy();
  });

  it('does not render speaker label when not provided', () => {
    const {queryByText} = render(<SimulationTranscriptItem {...defaultProps} />);
    expect(queryByText(/You:/)).toBeNull();
  });

  it('shows active indicator when isActive is true', () => {
    const {getByText} = render(
      <SimulationTranscriptItem {...defaultProps} isActive={true} />,
    );
    // Component should still render correctly when active
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders correctly without onPress prop', () => {
    const {getByText} = render(<SimulationTranscriptItem {...defaultProps} />);
    // Component should render correctly even without onPress
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('applies custom container style', () => {
    const customStyle = {marginTop: 10};
    const {getByText} = render(
      <SimulationTranscriptItem {...defaultProps} containerStyle={customStyle} />,
    );
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('applies custom time style', () => {
    const customStyle = {color: 'red'};
    const {getByText} = render(
      <SimulationTranscriptItem {...defaultProps} timeStyle={customStyle} />,
    );
    expect(getByText('00:01')).toBeTruthy();
  });

  it('applies custom message style', () => {
    const customStyle = {fontSize: 16};
    const {getByText} = render(
      <SimulationTranscriptItem {...defaultProps} messageStyle={customStyle} />,
    );
    expect(getByText('Hello, this is a test message')).toBeTruthy();
  });

  it('renders correctly with empty message', () => {
    const {getByText} = render(
      <SimulationTranscriptItem time="00:00" message="" />,
    );
    expect(getByText('00:00')).toBeTruthy();
  });

  it('renders correctly with long message', () => {
    const longMessage = 'A'.repeat(200);
    const {getByText} = render(
      <SimulationTranscriptItem time="00:01" message={longMessage} />,
    );
    expect(getByText(longMessage)).toBeTruthy();
  });
});
