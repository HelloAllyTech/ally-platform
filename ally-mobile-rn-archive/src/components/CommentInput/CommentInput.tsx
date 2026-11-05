import {useEffect} from 'react';
import {BottomSheetTextInput, BottomSheetView} from '@gorhom/bottom-sheet';
import {
  ActivityIndicator,
  Keyboard,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {BottomSheet} from '@/components/BottomSheet';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily, radius, typography} from '@/theme';

export interface CommentInputProps {
  visible: boolean;
  onClose: () => void;
  onChangeText: (text: string) => void;
  onSend: () => void;
  comment: string;
  onFocus?: () => void;
  isSendButtonDisabled?: boolean;
  isLoading?: boolean;
}

export const CommentInput: React.FC<CommentInputProps> = ({
  visible,
  onClose,
  onChangeText,
  onSend,
  comment,
  onFocus,
  isSendButtonDisabled = false,
  isLoading = false,
}) => {
  const {t} = useTranslate();
  useEffect(() => {
    if (visible) {
      // Small delay to ensure bottom sheet is fully open
      setTimeout(() => {
        onFocus?.();
      }, 100);
    }
  }, [visible, onFocus]);

  // Dismiss keyboard when bottom sheet closes
  useEffect(() => {
    if (!visible) {
      Keyboard.dismiss();
    }
  }, [visible]);

  const handleSend = () => {
    if (!isSendButtonDisabled) {
      onSend();
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={25}
      allowFullExpand={false}
      showBackdrop
      enablePanDownToClose
      showHandle={false}
      backgroundColor={colors.white}>
      <BottomSheetView style={styles.content}>
        <View style={styles.inputContainer}>
          <BottomSheetTextInput
            style={styles.input}
            value={comment}
            placeholder={t('commentInput.placeholder')}
            placeholderTextColor={colors.ds.typography.mediumEmphasis}
            onChangeText={onChangeText}
            onFocus={onFocus}
            multiline={false}
          />
          <TouchableOpacity
            activeOpacity={isSendButtonDisabled ? 0 : 0.7}
            style={[
              styles.sendButton,
              isSendButtonDisabled && styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={isSendButtonDisabled}>
            {isLoading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <LeftArrowIcon
                color={colors.white}
                width={32}
                height={32}
                style={styles.arrowIcon}
              />
            )}
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = ScaledSheet.create({
  content: {
    flex: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
    paddingTop: '12@mvs',
    paddingBottom: '30@mvs',
    gap: '8@ms',
  },
  input: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: radius.full,
    paddingVertical: '8@mvs',
    paddingHorizontal: '8@ms',
    backgroundColor: colors.lightGray,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  sendButton: {
    padding: '12@mvs',
    width: '32@ms',
    height: '32@ms',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.ds.theme.primary,
  },
  sendButtonDisabled: {
    backgroundColor: colors.ds.state.disabledContent,
  },
  arrowIcon: {
    transform: [{rotate: '180deg'}],
  },
});
