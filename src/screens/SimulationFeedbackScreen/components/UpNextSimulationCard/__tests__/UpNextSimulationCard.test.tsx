import React from 'react';
import {render} from '@testing-library/react-native';

import {UpNextSimulationCard} from '../UpNextSimulationCard';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/theme', () => {
  const handler: ProxyHandler<any> = {
    get: (_target, prop) => {
      if (prop === '__esModule') return false;
      if (typeof prop === 'symbol') return undefined;
      return new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
    },
  };
  const deepProxy = new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
  return {
    __esModule: true,
    colors: deepProxy,
    fontFamily: deepProxy,
    typography: deepProxy,
    radius: deepProxy,
    stroke: deepProxy,
  };
});

const mockUpNext = {
  id: 1,
  title: 'Next Simulation',
  description: 'Practice your negotiation skills',
  order: 2,
  coverImageUrl: 'https://example.com/cover.jpg',
};

describe('UpNextSimulationCard', () => {
  it('renders the simulation title', () => {
    const {getByText} = render(<UpNextSimulationCard upNext={mockUpNext as any} />);
    expect(getByText('Next Simulation')).toBeTruthy();
  });

  it('renders the simulation description', () => {
    const {getByText} = render(<UpNextSimulationCard upNext={mockUpNext as any} />);
    expect(getByText('Practice your negotiation skills')).toBeTruthy();
  });

  it('renders the up-next label with order number', () => {
    const {getByText} = render(<UpNextSimulationCard upNext={mockUpNext as any} />);
    expect(getByText(/postSim\.tabs\.upNext/)).toBeTruthy();
    expect(getByText(/2/)).toBeTruthy();
  });

  it('renders scenario label', () => {
    const {getByText} = render(<UpNextSimulationCard upNext={mockUpNext as any} />);
    expect(getByText(/common\.scenario/)).toBeTruthy();
  });

  it('renders cover image when coverImageUrl is provided', () => {
    const {UNSAFE_root} = render(<UpNextSimulationCard upNext={mockUpNext as any} />);
    const images = UNSAFE_root.findAllByType('Image' as any);
    expect(images.length).toBeGreaterThan(0);
  });

  it('does not render cover image when coverImageUrl is absent', () => {
    const noCoverUpNext = {...mockUpNext, coverImageUrl: undefined};
    const {UNSAFE_root} = render(<UpNextSimulationCard upNext={noCoverUpNext as any} />);
    const images = UNSAFE_root.findAllByType('Image' as any);
    expect(images).toHaveLength(0);
  });
});
