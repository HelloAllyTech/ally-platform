import React from 'react';
import {render} from '@testing-library/react-native';

import {SectionHeader} from '../SectionHeader';

jest.mock('@/assets/icons', () => ({
  ArrowDown: () => null,
  ArrowRight: () => null,
  CheckIcon: () => null,
  CloseCircle: () => null,
  EditSquareIcon: () => null,
  WandStarsIcon: () => null,
}));

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

describe('CallSummaryScreen/SectionHeader', () => {
  it('renders label', () => {
    const {getByText} = render(
      <SectionHeader
        label="Label"
        isExpanded={true}
        onToggle={() => {}}
        icon={<></>}
        canEdit={true}
        canEnhance={true}
        isEditing={false}
        onTickPress={() => {}}
        onClosePress={() => {}}
        onEditPress={() => {}}
        onWandPress={() => {}}
      />,
    );
    expect(getByText('Label')).toBeTruthy();
  });
});


