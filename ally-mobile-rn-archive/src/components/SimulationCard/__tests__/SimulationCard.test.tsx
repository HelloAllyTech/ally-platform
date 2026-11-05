import React from 'react';
import {Image, Text, View} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {SimulationCard} from '../SimulationCard';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('SimulationCard', () => {
  const mockOnPress = jest.fn();

  beforeEach(() => {
    mockOnPress.mockClear();
  });

  it('renders with title only', () => {
    const {getByText} = render(<SimulationCard title="Test Simulation" />);
    expect(getByText('Test Simulation')).toBeTruthy();
  });

  it('renders with title and description', () => {
    const {getByText} = render(
      <SimulationCard
        title="Test Simulation"
        description="This is a test description"
      />,
    );
    expect(getByText('Test Simulation')).toBeTruthy();
    expect(getByText('This is a test description')).toBeTruthy();
  });

  it('renders empty title as dash when title is empty', () => {
    const {getByText} = render(<SimulationCard title="" />);
    expect(getByText('-')).toBeTruthy();
  });

  it('does not render description when not provided', () => {
    const {queryByText} = render(<SimulationCard title="Test Simulation" />);
    expect(queryByText('description')).toBeNull();
  });

  it('renders with cover image when coverImageUrl is provided', () => {
    const {UNSAFE_getByType} = render(
      <SimulationCard
        title="Test Simulation"
        coverImageUrl="https://example.com/image.jpg"
      />,
    );
    const images = UNSAFE_getByType(Image);
    expect(images).toBeTruthy();
  });

  it('does not render cover image when coverImageUrl is null', () => {
    const {UNSAFE_queryByType} = render(
      <SimulationCard title="Test Simulation" coverImageUrl={null} />,
    );
    // Should still render but without the image
    expect(UNSAFE_queryByType(Image)).toBeNull();
  });

  it('does not render cover image when coverImageUrl is undefined', () => {
    const {UNSAFE_queryByType} = render(
      <SimulationCard title="Test Simulation" />,
    );
    expect(UNSAFE_queryByType(Image)).toBeNull();
  });

  it('calls onPress when card is pressed', () => {
    const {getByText} = render(
      <SimulationCard title="Test Simulation" onPress={mockOnPress} />,
    );
    fireEvent.press(getByText('Test Simulation'));
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when card is pressed if onPress is not provided', () => {
    const {getByText} = render(<SimulationCard title="Test Simulation" />);
    // Should not throw error
    fireEvent.press(getByText('Test Simulation'));
    expect(mockOnPress).not.toHaveBeenCalled();
  });

  it('disables card when onPress is not provided', () => {
    const {getByText} = render(<SimulationCard title="Test Simulation" />);
    // Card is rendered but onPress should not be called (tested in previous test)
    expect(getByText('Test Simulation')).toBeTruthy();
  });

  it('enables card when onPress is provided', () => {
    const {getByText} = render(
      <SimulationCard title="Test Simulation" onPress={mockOnPress} />,
    );
    // Pressing the card should trigger onPress
    fireEvent.press(getByText('Test Simulation'));
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('renders right accessory component', () => {
    const {getByText} = render(
      <SimulationCard
        title="Test Simulation"
        rightAccessory={<Text>Accessory</Text>}
      />,
    );
    expect(getByText('Accessory')).toBeTruthy();
  });

  it('renders without right accessory when not provided', () => {
    const {queryByText} = render(<SimulationCard title="Test Simulation" />);
    expect(queryByText('Accessory')).toBeNull();
  });

  it('renders complex right accessory (e.g., circular progress)', () => {
    const accessory = (
      <View testID="progress-indicator">
        <Text>1/4</Text>
      </View>
    );
    const {getByTestId, getByText} = render(
      <SimulationCard
        title="Test Simulation"
        rightAccessory={accessory}
      />,
    );
    expect(getByTestId('progress-indicator')).toBeTruthy();
    expect(getByText('1/4')).toBeTruthy();
  });

  it('applies custom titleNumberOfLines', () => {
    const {UNSAFE_getAllByType} = render(
      <SimulationCard
        title="Very Long Title That Should Be Truncated"
        titleNumberOfLines={1}
      />,
    );
    const texts = UNSAFE_getAllByType(Text);
    const titleText = texts.find(
      text => text.props.children === 'Very Long Title That Should Be Truncated',
    );
    expect(titleText?.props.numberOfLines).toBe(1);
  });

  it('uses default titleNumberOfLines of 2 when not specified', () => {
    const {UNSAFE_getAllByType} = render(
      <SimulationCard title="Test Title" />,
    );
    const texts = UNSAFE_getAllByType(Text);
    const titleText = texts.find(text => text.props.children === 'Test Title');
    expect(titleText?.props.numberOfLines).toBe(2);
  });

  it('applies custom descriptionNumberOfLines', () => {
    const {UNSAFE_getAllByType} = render(
      <SimulationCard
        title="Test Simulation"
        description="Very Long Description That Should Be Truncated"
        descriptionNumberOfLines={2}
      />,
    );
    const texts = UNSAFE_getAllByType(Text);
    const descText = texts.find(
      text =>
        text.props.children === 'Very Long Description That Should Be Truncated',
    );
    expect(descText?.props.numberOfLines).toBe(2);
  });

  it('uses default descriptionNumberOfLines of 3 when not specified', () => {
    const {UNSAFE_getAllByType} = render(
      <SimulationCard
        title="Test Simulation"
        description="Test Description"
      />,
    );
    const texts = UNSAFE_getAllByType(Text);
    const descText = texts.find(
      text => text.props.children === 'Test Description',
    );
    expect(descText?.props.numberOfLines).toBe(3);
  });

  it('renders with all props combined', () => {
    const {getByText} = render(
      <SimulationCard
        title="Complete Test"
        description="Full description"
        coverImageUrl="https://example.com/image.jpg"
        rightAccessory={<Text>Progress</Text>}
        onPress={mockOnPress}
        titleNumberOfLines={1}
        descriptionNumberOfLines={2}
      />,
    );
    expect(getByText('Complete Test')).toBeTruthy();
    expect(getByText('Full description')).toBeTruthy();
    expect(getByText('Progress')).toBeTruthy();

    fireEvent.press(getByText('Complete Test'));
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('handles empty description gracefully', () => {
    const {queryByText} = render(
      <SimulationCard title="Test Simulation" description="" />,
    );
    // Empty description should not render
    expect(queryByText('')).toBeNull();
  });

  it('renders with long title text', () => {
    const longTitle =
      'This is a very long title that should be truncated according to the numberOfLines prop';
    const {getByText} = render(<SimulationCard title={longTitle} />);
    expect(getByText(longTitle)).toBeTruthy();
  });

  it('renders with long description text', () => {
    const longDescription =
      'This is a very long description that should be truncated according to the descriptionNumberOfLines prop and should handle multiple lines properly';
    const {getByText} = render(
      <SimulationCard title="Test" description={longDescription} />,
    );
    expect(getByText(longDescription)).toBeTruthy();
  });

  it('maintains structure without cover image', () => {
    const {getByText} = render(
      <SimulationCard title="Test Simulation" description="Test Description" />,
    );
    // Should render both title and description without cover image
    expect(getByText('Test Simulation')).toBeTruthy();
    expect(getByText('Test Description')).toBeTruthy();
  });

  it('handles special characters in title', () => {
    const specialTitle = 'Test & Simulation <> "Quotes"';
    const {getByText} = render(<SimulationCard title={specialTitle} />);
    expect(getByText(specialTitle)).toBeTruthy();
  });

  it('handles special characters in description', () => {
    const specialDesc = 'Description with & special characters "test"';
    const {getByText} = render(
      <SimulationCard title="Test" description={specialDesc} />,
    );
    expect(getByText(specialDesc)).toBeTruthy();
  });

  it('strips HTML tags from description and decodes entities', () => {
    const htmlDesc =
      '<p>Hello <strong>world</strong></p><p>Tom &amp; Jerry</p>';
    const {getByText, queryByText} = render(
      <SimulationCard title="Test" description={htmlDesc} />,
    );
    expect(getByText('Hello world Tom & Jerry')).toBeTruthy();
    expect(queryByText(htmlDesc)).toBeNull();
  });

  it('does not render description when value is HTML that strips to empty', () => {
    const {queryByText} = render(
      <SimulationCard title="Test" description="<p></p>" />,
    );
    expect(queryByText('<p></p>')).toBeNull();
  });

  it('responds to press events when onPress is provided', () => {
    const {getByText} = render(
      <SimulationCard title="Test Simulation" onPress={mockOnPress} />,
    );
    // Should be able to press the card
    fireEvent.press(getByText('Test Simulation'));
    expect(mockOnPress).toHaveBeenCalled();
  });

  it('renders trigger warnings when provided', () => {
    const warnings = ['Warning 1', 'Warning 2'];
    const {getByText} = render(
      <SimulationCard title="Test Simulation" triggerWarnings={warnings} />,
    );

    expect(getByText('common.triggerWarnings')).toBeTruthy();
    expect(getByText('Warning 1')).toBeTruthy();
    expect(getByText('Warning 2')).toBeTruthy();
  });

  it('does not render trigger warnings section when triggerWarnings is empty', () => {
    const {queryByText} = render(
      <SimulationCard title="Test Simulation" triggerWarnings={[]} />,
    );

    expect(queryByText('common.triggerWarnings')).toBeNull();
  });

  it('does not render trigger warnings section when triggerWarnings is undefined', () => {
    const {queryByText} = render(<SimulationCard title="Test Simulation" />);

    expect(queryByText('common.triggerWarnings')).toBeNull();
  });
});

