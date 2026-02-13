import React from 'react';
import {
  StyleProp,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon} from '@/assets';
import {Button} from '@/components';
import {colors, fontFamily, typography} from '@/theme';

interface IllustratedModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description: string;
  actionButtonText?: string;
  onActionPress?: () => void;
  actionButtonColor?: string;
  actionTextColor?: string;
  illustration?: React.ReactNode;
  titleMain: string;
  titleItalic?: string;
  actionButtonStyle?: StyleProp<ViewStyle>;
  descriptionStyle?: StyleProp<TextStyle>;
}

export const IllustratedModal: React.FC<IllustratedModalProps> = ({
  visible,
  onClose,
  description,
  actionButtonText,
  onActionPress,
  actionButtonColor = colors.brightRed,
  actionTextColor = colors.white,
  illustration,
  titleMain,
  titleItalic,
  actionButtonStyle = {},
  descriptionStyle = {},
}) => {
  if (!visible) return null;

  const handleActionPress = () => {
    onActionPress?.();
    onClose();
  };

  const renderTitle = () => {
    return (
      <Text style={styles.title}>
        <Text style={styles.marginLeft4}>{titleMain}</Text>
        {titleItalic && <Text style={styles.titleItalic}>{titleItalic}</Text>}
      </Text>
    );
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.modalContainer}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <CloseIcon />
        </TouchableOpacity>

        {renderTitle()}

        {illustration && (
          <View style={styles.illustrationContainer}>{illustration}</View>
        )}

        <Text style={[styles.description, descriptionStyle]}>
          {description}
        </Text>

        {!!actionButtonText && !!onActionPress && (
          <Button
            label={actionButtonText}
            onPress={handleActionPress}
            customContainerStyle={[
              styles.actionButton,
              actionButtonStyle,
              {backgroundColor: actionButtonColor},
            ]}
            customTextStyle={[
              styles.actionButtonText,
              {color: actionTextColor},
            ]}
          />
        )}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.blackTransparent50,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    zIndex: 1000,
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    padding: '16@s',
    minWidth: '280@ms',
    maxWidth: '80%',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: '8@ms',
    right: '8@ms',
    width: '24@ms',
    height: '24@ms',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '20@ms',
    textAlign: 'center',
    marginBottom: '16@mvs',
    marginTop: '8@mvs',
  },
  marginLeft4: {
    marginRight: '8@ms',
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    marginLeft: '40@ms',
  },
  illustrationContainer: {
    marginBottom: '20@mvs',
    alignItems: 'center',
    width: '100%',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.darkGray2,
    textAlign: 'center',
    marginBottom: '16@mvs',
    lineHeight: '20@mvs',
  },
  actionButton: {
    width: '100%',
    paddingHorizontal: '20@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    ...typography.body.medium,
    fontWeight: '600',
    textAlign: 'center',
  },
});
