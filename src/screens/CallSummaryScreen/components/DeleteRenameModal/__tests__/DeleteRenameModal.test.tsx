import React from 'react';
import {render} from '@testing-library/react-native';

import {DeleteRenameModal} from '../DeleteRenameModal';

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    CustomModal: (props: any) => <Text>{props.title}</Text>,
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

describe('CallSummaryScreen/DeleteRenameModal', () => {
  it('shows delete modal title when activeModal=delete', () => {
    const {getByText} = render(
      <DeleteRenameModal
        activeModal="delete"
        setActiveModal={() => {}}
        handleDelete={() => {}}
        handleBlur={() => {}}
        editedName=""
        setEditedName={() => {}}
      />,
    );
    expect(getByText('CallSummary.customMenu.delete')).toBeTruthy();
  });
});


