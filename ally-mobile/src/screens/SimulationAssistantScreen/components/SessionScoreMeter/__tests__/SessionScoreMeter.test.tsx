import React from 'react';
import {render} from '@testing-library/react-native';

import {SessionScoreMeter} from '../SessionScoreMeter';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));

describe('SessionScoreMeter', () => {
  it('renders and re-renders without crashing when score changes', () => {
    const {rerender} = render(
      <SessionScoreMeter score={-100} segments={5} animate={false} />,
    );
    // Rerender with a different score to force pointer position recalculation
    rerender(<SessionScoreMeter score={100} segments={5} animate={false} />);
  });
});


