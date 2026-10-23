import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ResourceArticleCard} from '@/components/ResourceArticleCard';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/assets', () => ({
  DownArrowIcon: () => null,
}));

describe('ResourceArticleCard', () => {
  const content = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

  it('renders category, heading and tags', () => {
    const {getByText} = render(
      <ResourceArticleCard
        category="Cat"
        tags={["t1", "t2"]}
        heading="Heading"
        content={content}
      />,
    );

    expect(getByText('Cat')).toBeTruthy();
    expect(getByText('Heading')).toBeTruthy();
    expect(getByText('t1')).toBeTruthy();
    expect(getByText('t2')).toBeTruthy();
  });

  it('toggles expand and collapse on press', () => {
    const {getByText, queryByText} = render(
      <ResourceArticleCard
        category="Cat"
        tags={[]}
        heading="Heading"
        content={content}
      />,
    );

    // Initially collapsed: should show truncated text container with "view more" label
    const viewMore = getByText('common.viewMore');
    fireEvent.press(viewMore);

    // After expanding, content should still be visible
    expect(getByText(content)).toBeTruthy();

    // Tap on expanded content area to collapse
    fireEvent.press(getByText(content));

    // Collapsed again, "view more" should be visible
    expect(getByText('common.viewMore')).toBeTruthy();
  });
});
