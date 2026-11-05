import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ArchiveIcon: (props: any) => <View testID="archive-icon" {...props} />,
    ContractIcon: (props: any) => <View testID="contract-icon" {...props} />,
    EditIcon: (props: any) => <View testID="edit-icon" {...props} />,
    ExportIcon: (props: any) => <View testID="export-icon" {...props} />,
    UnarchiveIcon: (props: any) => <View testID="unarchive-icon" {...props} />,
  };
});

jest.mock('@/constants', () => ({
  PRIVACY_POLICY_URL: 'https://example.com/privacy',
}));

const mockDeleteRenameModal = jest.fn();
const mockCustomMenuModal = jest.fn();
const mockArchiveActionModal = jest.fn();
const mockFeedbackPopup = jest.fn();

jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    FeedbackPopup: (props: any) => {
      mockFeedbackPopup(props);
      return props.visible ? <View testID="feedback-popup" /> : null;
    },
  };
});

jest.mock('../../index', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    CustomMenuModal: (props: any) => {
      mockCustomMenuModal(props);
      return props.visible ? <View testID="custom-menu-modal" /> : null;
    },
    DeleteRenameModal: (props: any) => {
      mockDeleteRenameModal(props);
      return <View testID="delete-rename-modal" />;
    },
    ArchiveActionModal: (props: any) => {
      mockArchiveActionModal(props);
      return props.visible ? <View testID="archive-action-modal" /> : null;
    },
  };
});

import {SummaryModals} from '../SummaryModals';

const baseProps = {
  activeModal: null as 'rename' | 'delete' | null,
  setActiveModal: jest.fn(),
  handleDelete: jest.fn(),
  handleBlur: jest.fn(),
  editedName: '',
  setEditedName: jest.fn(),
  isMenuVisible: false,
  hideMenu: jest.fn(),
  handleExport: jest.fn(),
  actionType: 'archive' as const,
  showArchiveConfirmation: false,
  setShowArchiveConfirmation: jest.fn(),
  onArchive: jest.fn(),
  showExportOption: false,
  isSummaryFeedbackPopup: false,
  hideSummaryFeedbackPopup: jest.fn(),
  onSubmitSummaryFeedback: jest.fn(),
};

describe('SummaryModals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders DeleteRenameModal', () => {
    const {getByTestId} = render(<SummaryModals {...baseProps} />);
    expect(getByTestId('delete-rename-modal')).toBeTruthy();
  });

  it('passes activeModal to DeleteRenameModal', () => {
    render(<SummaryModals {...baseProps} activeModal="rename" />);
    expect(mockDeleteRenameModal).toHaveBeenCalledWith(
      expect.objectContaining({activeModal: 'rename'}),
    );
  });

  it('shows CustomMenuModal when isMenuVisible is true', () => {
    const {getByTestId} = render(
      <SummaryModals {...baseProps} isMenuVisible={true} />,
    );
    expect(getByTestId('custom-menu-modal')).toBeTruthy();
  });

  it('hides CustomMenuModal when isMenuVisible is false', () => {
    const {queryByTestId} = render(
      <SummaryModals {...baseProps} isMenuVisible={false} />,
    );
    expect(queryByTestId('custom-menu-modal')).toBeNull();
  });

  it('shows FeedbackPopup when isSummaryFeedbackPopup is true', () => {
    const {getByTestId} = render(
      <SummaryModals {...baseProps} isSummaryFeedbackPopup={true} />,
    );
    expect(getByTestId('feedback-popup')).toBeTruthy();
  });

  it('hides FeedbackPopup when isSummaryFeedbackPopup is false', () => {
    const {queryByTestId} = render(
      <SummaryModals {...baseProps} isSummaryFeedbackPopup={false} />,
    );
    expect(queryByTestId('feedback-popup')).toBeNull();
  });

  it('shows ArchiveActionModal when showArchiveConfirmation is true', () => {
    const {getByTestId} = render(
      <SummaryModals {...baseProps} showArchiveConfirmation={true} />,
    );
    expect(getByTestId('archive-action-modal')).toBeTruthy();
  });

  it('does not render ArchiveActionModal when actionType is null', () => {
    const {queryByTestId} = render(
      <SummaryModals
        {...baseProps}
        actionType={null}
        showArchiveConfirmation={true}
      />,
    );
    expect(queryByTestId('archive-action-modal')).toBeNull();
  });

  it('passes 4 menu options by default (no export)', () => {
    render(<SummaryModals {...baseProps} isMenuVisible={true} />);
    const options = mockCustomMenuModal.mock.calls[0][0].options;
    expect(options).toHaveLength(3);
  });

  it('passes 4 menu options when showExportOption is true', () => {
    render(
      <SummaryModals {...baseProps} isMenuVisible={true} showExportOption={true} />,
    );
    const options = mockCustomMenuModal.mock.calls[0][0].options;
    expect(options).toHaveLength(4);
  });

  it('shows unarchive label when actionType is unarchive', () => {
    render(
      <SummaryModals
        {...baseProps}
        isMenuVisible={true}
        actionType="unarchive"
      />,
    );
    const options = mockCustomMenuModal.mock.calls[0][0].options;
    const archiveOption = options.find((o: any) =>
      o.label.includes('unarchive'),
    );
    expect(archiveOption).toBeTruthy();
  });
});
