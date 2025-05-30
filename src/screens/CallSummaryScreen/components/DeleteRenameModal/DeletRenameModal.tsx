import {CustomModal} from '@/components/Modal/CustomModal';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';

interface DeleteRenameModalProps {
  activeModal: string;
  setActiveModal: (modal: string | null) => void;
  handleDelete: () => void;
  handleBlur: () => void;
  editedName: string;
  setEditedName: (name: string) => void;
}

export const DeleteRenameModal: React.FC<DeleteRenameModalProps> = ({
  activeModal,
  setActiveModal,
  handleDelete,
  handleBlur,
  editedName,
  setEditedName,
}) => {
  const {t} = useTranslate();

  if (activeModal === 'delete') {
    return (
      <CustomModal
        visible={activeModal === 'delete'}
        onClose={() => setActiveModal(null)}
        title={t('CallSummary.customMenu.delete')}
        primaryButtonText={t('CallSummary.customMenu.delete')}
        secondaryButtonText={t('CallSummary.info.cancel')}
        onPrimaryPress={handleDelete}
        onSecondaryPress={() => setActiveModal(null)}
        description={t('CallSummary.customMenu.deleteConfirmation')}
        primaryTextColor={colors.brightRed}
      />
    );
  }

  if (activeModal === 'rename') {
    return (
      <CustomModal
        visible={activeModal === 'rename'}
        onClose={() => setActiveModal(null)}
        title={t('CallSummary.info.rename')}
        primaryButtonText={t('CallSummary.info.confirm')}
        secondaryButtonText={t('CallSummary.info.cancel')}
        onPrimaryPress={handleBlur}
        onSecondaryPress={() => setActiveModal(null)}
        showInput
        inputProps={{
          value: editedName,
          onChangeText: setEditedName,
        }}
      />
    );
  }
};
