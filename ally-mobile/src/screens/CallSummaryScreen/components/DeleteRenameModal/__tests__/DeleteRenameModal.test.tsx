import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {DeleteRenameModal} from '../DeleteRenameModal';

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    CustomModal: (props: any) => (
      <Text onPress={props.onPrimaryPress} testID="modal">
        {props.title}
      </Text>
    ),
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
    expect(getByText('callSummary.customMenu.delete')).toBeTruthy();
  });

  it('invokes delete on primary press in delete modal', () => {
    const handleDelete = jest.fn();
    const {getByTestId} = render(
      <DeleteRenameModal
        activeModal="delete"
        setActiveModal={() => {}}
        handleDelete={handleDelete}
        handleBlur={() => {}}
        editedName=""
        setEditedName={() => {}}
      />,
    );
    fireEvent.press(getByTestId('modal'));
    expect(handleDelete).toHaveBeenCalled();
  });

  it('shows rename modal and calls blur confirm', () => {
    const handleBlur = jest.fn();
    const {getByText, getByTestId} = render(
      <DeleteRenameModal
        activeModal="rename"
        setActiveModal={() => {}}
        handleDelete={() => {}}
        handleBlur={handleBlur}
        editedName="Name"
        setEditedName={() => {}}
      />,
    );
    expect(getByText('callSummary.info.rename')).toBeTruthy();
    fireEvent.press(getByTestId('modal'));
    expect(handleBlur).toHaveBeenCalled();
  });
});


