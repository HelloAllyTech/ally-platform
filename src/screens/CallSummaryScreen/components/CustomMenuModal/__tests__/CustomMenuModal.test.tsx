import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {CustomMenuModal} from '../CustomMenuModal';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({ openURL: jest.fn() }));

jest.mock('@/assets/icons', () => ({
  ArchiveIcon: () => null,
  ContractIcon: () => null,
  EditIcon: () => null,
  ExportIcon: () => null,
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

describe('CallSummaryScreen/CustomMenuModal', () => {
  it('renders when visible and triggers rename/export', () => {
    const onClose = jest.fn();
    const onExport = jest.fn();
    const onArchive = jest.fn();
    const setModalType = jest.fn();

    const {getByText} = render(
      <CustomMenuModal
        visible
        onClose={onClose}
        onExport={onExport}
        onArchive={onArchive}
        setModalType={setModalType}
        showExportOption
        actionType="archive"
      />,
    );

    fireEvent.press(getByText('CallSummary.info.rename'));
    expect(setModalType).toHaveBeenCalledWith('rename');
  });
});


