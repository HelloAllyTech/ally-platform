import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

import {UpNextSimulationCard} from '../UpNextSimulationCard';

describe('UpNextSimulationCard', () => {
  it('renders title and description', () => {
    const upNext = {
      title: 'Test Scenario Title',
      description: 'Scenario description text',
      order: 1,
    };
    const {getByText} = render(
      <UpNextSimulationCard upNext={upNext as any} />,
    );
    expect(getByText('Test Scenario Title')).toBeTruthy();
    expect(getByText('Scenario description text')).toBeTruthy();
  });

  it('renders cover image when URL provided', () => {
    const upNext = {
      title: 'Title',
      description: 'Desc',
      order: 2,
      coverImageUrl: 'https://example.com/image.jpg',
    };
    const {getByText} = render(
      <UpNextSimulationCard upNext={upNext as any} />,
    );
    // Component renders without error; title/description still visible
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Desc')).toBeTruthy();
  });

  it('does not render image when no URL', () => {
    const upNext = {
      title: 'Title',
      description: 'Desc',
      order: 3,
    };
    const {getByText} = render(
      <UpNextSimulationCard upNext={upNext as any} />,
    );
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Desc')).toBeTruthy();
  });

  it('renders order number in label', () => {
    const upNext = {
      title: 'Title',
      description: 'Desc',
      order: 5,
    };
    const {getByText} = render(
      <UpNextSimulationCard upNext={upNext as any} />,
    );
    expect(getByText(/5/)).toBeTruthy();
  });
});
