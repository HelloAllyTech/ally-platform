import React from 'react';
import {render} from '@testing-library/react-native';

import {FeedbackDropdown} from '../FeedbackDropdown';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('@/assets', () => ({
  SimulationIcon: () => null,
  TickIcon: () => null,
  TranscriptIcon: () => null,
}));

jest.mock('@/components', () => ({
  DropdownMenu: (props: any) => {
    // expose props globally for assertions without referencing React in factory
    (global as any).__dropdownProps = props;
    return null;
  },
}));

describe('FeedbackDropdown', () => {
  it('renders two items and toggles selection', () => {
    const setShowSummary = jest.fn();
    const onClose = jest.fn();
    render(
      <FeedbackDropdown
        visible={true}
        onClose={onClose}
        showSummary={true}
        setShowSummary={setShowSummary}
      />,
    );
    const props = (global as any).__dropdownProps;
    expect(props).toBeTruthy();
    expect(props.items.length).toBe(2);
    props.items[1].onPress();
    expect(setShowSummary).toHaveBeenCalledWith(false);
    props.onClose();
    expect(onClose).toHaveBeenCalled();
  });
});


