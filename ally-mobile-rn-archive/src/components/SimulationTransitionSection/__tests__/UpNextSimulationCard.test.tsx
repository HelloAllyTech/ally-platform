import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/theme', () => ({
  colors: {
    white: '#fff',
    ds: {
      grey: {50: '#fafafa', 200: '#eee'},
      typography: {highEmphasis: '#111', mediumEmphasis: '#666'},
    },
  },
  fontFamily: {IBM_PLEX_SERIF: {REGULAR: {}, MEDIUM: {}}},
  radius: {lg: 12},
  stroke: {primary: '#ccc'},
  typography: {body: {small: {}, medium: {}}},
}));

import {UpNextSimulationCard} from '../UpNextSimulationCard';

describe('UpNextSimulationCard', () => {
  const baseUpNext = {
    id: '1',
    title: 'Next Simulation',
    description: 'Description of next sim',
    order: 2,
    coverImageUrl: 'https://example.com/cover.jpg',
    scenarioId: 'sc-1',
  };

  it('renders title and description', () => {
    const {getByText} = render(
      <UpNextSimulationCard upNext={baseUpNext as any} />,
    );

    expect(getByText('Next Simulation')).toBeTruthy();
    expect(getByText('Description of next sim')).toBeTruthy();
  });

  it('renders order number in label', () => {
    const {getByText} = render(
      <UpNextSimulationCard upNext={baseUpNext as any} />,
    );

    expect(
      getByText('postSim.tabs.upNext - common.simulation 2'),
    ).toBeTruthy();
  });

  it('renders scenario label', () => {
    const {getByText} = render(
      <UpNextSimulationCard upNext={baseUpNext as any} />,
    );

    expect(getByText('learn.scenario.scenarioLabel:')).toBeTruthy();
  });

  it('renders cover image when coverImageUrl is provided', () => {
    const {UNSAFE_root} = render(
      <UpNextSimulationCard upNext={baseUpNext as any} />,
    );

    const images = UNSAFE_root.findAll(
      node => (node.type as unknown) === 'Image' || (node.props?.source?.uri !== undefined),
    );
    expect(images.length).toBeGreaterThan(0);
  });

  it('does not render image when coverImageUrl is absent', () => {
    const upNext = {...baseUpNext, coverImageUrl: null};
    const {UNSAFE_root} = render(
      <UpNextSimulationCard upNext={upNext as any} />,
    );

    const images = UNSAFE_root.findAll(
      node =>
        node.props?.source?.uri !== undefined &&
        node.props?.source?.uri !== null,
    );
    expect(images).toHaveLength(0);
  });
});
