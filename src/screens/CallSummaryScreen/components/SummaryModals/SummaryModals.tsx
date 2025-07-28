import React from 'react';
import {Modal, Text, TouchableWithoutFeedback, View} from 'react-native';

import {styles} from '../../styles';
import CustomMenuModal from '../CustomMenuModal/CustomMenuModal';
import {DeleteRenameModal} from '../DeleteRenameModal/DeleteRenameModal';
import SummaryDropdown from '../Header/SummaryDropdown';

type ModalType = 'rename' | 'delete' | null;

interface SummaryModalsProps {
  activeModal: ModalType;
  setActiveModal: (modal: ModalType) => void;
  handleDelete: () => void;
  handleBlur: () => void;
  editedName: string;
  setEditedName: (name: string) => void;
  isMenuVisible: boolean;
  hideMenu: () => void;
  handleExport: () => void;
  isSummaryDropdownVisible: boolean;
  hideHeaderDropdown: () => void;
  isFullyExpanded: boolean;
  showSummary: boolean;
  setShowSummary: (show: boolean) => void;
  showInfoModal: boolean;
  setShowInfoModal: (show: boolean) => void;
}

export const SummaryModals: React.FC<SummaryModalsProps> = ({
  activeModal,
  setActiveModal,
  handleDelete,
  handleBlur,
  editedName,
  setEditedName,
  isMenuVisible,
  hideMenu,
  handleExport,
  isSummaryDropdownVisible,
  hideHeaderDropdown,
  isFullyExpanded,
  showSummary,
  setShowSummary,
  showInfoModal,
  setShowInfoModal,
}) => {
  return (
    <>
      <DeleteRenameModal
        activeModal={activeModal || ''}
        setActiveModal={modal => setActiveModal(modal as ModalType)}
        handleDelete={handleDelete}
        handleBlur={handleBlur}
        editedName={editedName}
        setEditedName={setEditedName}
      />
      <SummaryDropdown
        visible={isSummaryDropdownVisible}
        onClose={hideHeaderDropdown}
        isFullyExpanded={isFullyExpanded}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
      />
      <CustomMenuModal
        visible={isMenuVisible}
        onClose={hideMenu}
        onExport={handleExport}
        setModalType={setActiveModal}
      />
      <Modal
        visible={showInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}>
        <TouchableWithoutFeedback onPress={() => setShowInfoModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.infoPopupContainer}>
                <Text style={styles.infoPopupText}>
                  Your notes are auto-saved and will appear under 'Additional
                  Notes' after the summary and highlights are generated
                </Text>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};
