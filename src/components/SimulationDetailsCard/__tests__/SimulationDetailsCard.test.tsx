import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SimulationDetailsCard} from '../SimulationDetailsCard';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    ReviewTypeChip: ({reviewType}: {reviewType: string}) =>
      React.createElement(View, {testID: 'review-type-chip'}, reviewType),
    VideoPreview: ({videoUrl, testID}: {videoUrl: string; testID?: string}) =>
      React.createElement(View, {testID: testID || 'video-preview'}, videoUrl),
  };
});

describe('SimulationDetailsCard', () => {
  it('renders title', () => {
    const {getByText} = render(
      <SimulationDetailsCard title="Test Scenario" />,
    );
    expect(getByText('Test Scenario')).toBeTruthy();
  });

  it('renders title as dash when title is empty', () => {
    const {getByText} = render(<SimulationDetailsCard title="" />);
    expect(getByText('-')).toBeTruthy();
  });

  it('renders description when provided', () => {
    const {getByText} = render(
      <SimulationDetailsCard
        title="Test"
        description="Scenario description"
      />,
    );
    expect(getByText('Scenario description')).toBeTruthy();
  });

  it('renders review type chip when reviewType is provided', () => {
    const {getByTestId} = render(
      <SimulationDetailsCard title="Test" reviewType="simulation" />,
    );
    expect(getByTestId('review-type-chip')).toBeTruthy();
  });

  it('does not render review type chip when reviewType is not provided', () => {
    const {queryByTestId} = render(
      <SimulationDetailsCard title="Test" />,
    );
    expect(queryByTestId('review-type-chip')).toBeNull();
  });

  it('renders cover image when coverImageUrl is provided and coverVideoUrl is not', () => {
    const {UNSAFE_getByType} = render(
      <SimulationDetailsCard
        title="Test"
        coverImageUrl="https://example.com/cover.jpg"
      />,
    );
    const {Image} = require('react-native');
    const images = UNSAFE_getByType(Image);
    expect(images).toBeTruthy();
  });

  it('renders VideoPreview when coverVideoUrl is provided', () => {
    const {getByTestId} = render(
      <SimulationDetailsCard
        title="Test"
        coverVideoUrl="https://example.com/video.mp4"
      />,
    );
    expect(getByTestId('scenario-video-preview')).toBeTruthy();
  });

  it('does not render image when only coverVideoUrl is provided', () => {
    const {UNSAFE_queryByType} = render(
      <SimulationDetailsCard
        title="Test"
        coverVideoUrl="https://example.com/video.mp4"
      />,
    );
    const {Image} = require('react-native');
    expect(UNSAFE_queryByType(Image)).toBeNull();
  });

  it('toggles view more/less when description is truncated and view more is pressed', () => {
    const {getByText} = render(
      <SimulationDetailsCard
        title="Test"
        description="Long description that might get truncated in layout"
        descriptionNumberOfLines={2}
      />,
    );
    expect(getByText('Long description that might get truncated in layout')).toBeTruthy();

    // Simulate text layout with more than 2 lines to show "View more"
    const descText = getByText('Long description that might get truncated in layout');
    const twoLines = Array(2).fill({text: 'x', width: 10, height: 10});
    const threeLines = Array(3).fill({text: 'x', width: 10, height: 10});
    fireEvent(descText, 'textLayout', {
      nativeEvent: {lines: twoLines},
    });
    // After layout with 3+ lines, view more appears
    fireEvent(descText, 'textLayout', {
      nativeEvent: {lines: threeLines},
    });

    const viewMore = getByText('common.viewMore');
    expect(viewMore).toBeTruthy();
    fireEvent.press(viewMore);
    expect(getByText('common.viewLess')).toBeTruthy();
  });

  it('applies titleNumberOfLines to title', () => {
    const {UNSAFE_getAllByType} = render(
      <SimulationDetailsCard
        title="Test Title"
        titleNumberOfLines={2}
      />,
    );
    const {Text} = require('react-native');
    const texts = UNSAFE_getAllByType(Text);
    const titleEl = texts.find((t: any) => t.props.children === 'Test Title');
    expect(titleEl?.props.numberOfLines).toBe(2);
  });

  it('uses default titleNumberOfLines of 1', () => {
    const {UNSAFE_getAllByType} = render(
      <SimulationDetailsCard title="Test" />,
    );
    const {Text} = require('react-native');
    const texts = UNSAFE_getAllByType(Text);
    const titleEl = texts.find((t: any) => t.props.children === 'Test');
    expect(titleEl?.props.numberOfLines).toBe(1);
  });
});
