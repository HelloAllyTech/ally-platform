import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ArchiveActionModal} from '../ArchiveActionModal';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    ConfirmationModal: (props: {
      visible: boolean;
      title: string;
      subtitle?: string;
      description: string;
      confirmLabel: string;
      cancelLabel: string;
      confirmVariant?: string;
      onConfirm: () => void;
      onClose: () => void;
    }) =>
      props.visible
        ? React.createElement(
            View,
            {testID: 'confirmation-modal'},
            React.createElement(Text, null, props.title),
            props.subtitle && React.createElement(Text, null, props.subtitle),
            React.createElement(Text, null, props.description),
            React.createElement(Text, null, props.confirmLabel),
            React.createElement(Text, null, props.cancelLabel),
            React.createElement(Text, null, props.confirmVariant ?? ''),
            React.createElement(TouchableOpacity, {
              testID: 'confirm-button',
              onPress: props.onConfirm,
            }),
          )
        : null,
  };
});

describe('ArchiveActionModal', () => {
  const onClose = jest.fn();
  const onArchive = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders archive modal with archive translation keys', () => {
    const {getByText} = render(
      <ArchiveActionModal
        visible
        onClose={onClose}
        actionType="archive"
        onArchive={onArchive}
      />,
    );

    expect(
      getByText('callSummary.archiveActionModal.archive.header.title'),
    ).toBeTruthy();
    expect(
      getByText('callSummary.archiveActionModal.archive.header.subtitle'),
    ).toBeTruthy();
    expect(
      getByText('callSummary.archiveActionModal.archive.description'),
    ).toBeTruthy();
    expect(
      getByText('callSummary.archiveActionModal.archive.confirm'),
    ).toBeTruthy();
    expect(
      getByText('callSummary.archiveActionModal.archive.cancel'),
    ).toBeTruthy();
  });

  it('renders unarchive modal with unarchive keys', () => {
    const {getByText} = render(
      <ArchiveActionModal
        visible
        onClose={onClose}
        actionType="unarchive"
        onArchive={onArchive}
      />,
    );

    expect(
      getByText('callSummary.archiveActionModal.unarchive.header.title'),
    ).toBeTruthy();
    expect(
      getByText('callSummary.archiveActionModal.unarchive.header.subtitle'),
    ).toBeTruthy();
    expect(
      getByText('callSummary.archiveActionModal.unarchive.description'),
    ).toBeTruthy();
    expect(
      getByText('callSummary.archiveActionModal.unarchive.confirm'),
    ).toBeTruthy();
    expect(
      getByText('callSummary.archiveActionModal.unarchive.cancel'),
    ).toBeTruthy();
  });

  it('calls onArchive and onClose when confirmed', async () => {
    const {getByTestId} = render(
      <ArchiveActionModal
        visible
        onClose={onClose}
        actionType="archive"
        onArchive={onArchive}
      />,
    );

    fireEvent.press(getByTestId('confirm-button'));

    await Promise.resolve();

    expect(onArchive).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onArchive with false for unarchive when confirmed', async () => {
    const {getByTestId} = render(
      <ArchiveActionModal
        visible
        onClose={onClose}
        actionType="unarchive"
        onArchive={onArchive}
      />,
    );

    fireEvent.press(getByTestId('confirm-button'));

    await Promise.resolve();

    expect(onArchive).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('passes destructive variant for archive', () => {
    const {getByText} = render(
      <ArchiveActionModal
        visible
        onClose={onClose}
        actionType="archive"
        onArchive={onArchive}
      />,
    );

    expect(getByText('destructive')).toBeTruthy();
  });

  it('passes primary variant for unarchive', () => {
    const {getByText} = render(
      <ArchiveActionModal
        visible
        onClose={onClose}
        actionType="unarchive"
        onArchive={onArchive}
      />,
    );

    expect(getByText('primary')).toBeTruthy();
  });
});
