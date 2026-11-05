import React from 'react';
import {render} from '@testing-library/react-native';

import {EditableField} from '../EditableField';

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

describe('CallSummaryScreen/EditableField', () => {
  it('renders placeholder when value is empty', () => {
    const {getByText} = render(
      <EditableField
        fieldKey={1 as any}
        label="Notes"
        value={null}
        onChangeText={() => {}}
        placeholder="-"
        canEdit={false}
        isEditing={false}
        isEnhancing={false}
      />,
    );
    expect(getByText('-')).toBeTruthy();
  });
});


