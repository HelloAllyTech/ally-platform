import React, {useState} from 'react';
import {Modal, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

interface CustomModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  placeholder?: string;
  initialValue?: string;
  primaryButtonText: string;
  secondaryButtonText: string;
  onPrimaryPress: (value: string) => void;
  onSecondaryPress?: () => void;
  primaryButtonColor?: string;
  secondaryButtonColor?: string;
  primaryTextColor?: string;
  secondaryTextColor?: string;
  showInput?: boolean;
  inputProps?: any;
  description?: string;
}

export const CustomModal: React.FC<CustomModalProps> = ({
  visible,
  onClose,
  title,
  placeholder = '',
  initialValue = '',
  primaryButtonText,
  secondaryButtonText,
  onPrimaryPress,
  onSecondaryPress,
  primaryButtonColor = colors.white,
  secondaryButtonColor = colors.white,
  primaryTextColor = colors.blue,
  secondaryTextColor = colors.black,
  showInput = false,
  inputProps = {},
  description = '',
}) => {
  const [inputValue, setInputValue] = useState(initialValue);
  const [isFocused, setIsFocused] = useState(false);

  const handlePrimaryPress = () => {
    onPrimaryPress(inputValue);
    onClose();
  };

  const handleSecondaryPress = () => {
    if (onSecondaryPress) {
      onSecondaryPress();
    }
    onClose();
  };

  const handleModalClose = () => {
    setInputValue(initialValue);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleModalClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.title}>{title}</Text>

          {showInput && (
            <TextInput
              style={[styles.input, isFocused && styles.inputFocused]}
              value={inputValue}
              onChangeText={setInputValue}
              placeholder={placeholder}
              placeholderTextColor={colors.lightGray}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              {...inputProps}
            />
          )}

          {description && <Text style={styles.description}>{description}</Text>}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                {backgroundColor: secondaryButtonColor},
              ]}
              onPress={handleSecondaryPress}>
              <Text style={[styles.buttonText, {color: secondaryTextColor}]}>
                {secondaryButtonText}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                {backgroundColor: primaryButtonColor},
              ]}
              onPress={handlePrimaryPress}>
              <Text style={[styles.buttonText, {color: primaryTextColor}]}>
                {primaryButtonText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(19, 19, 19, 0.37)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    paddingTop: '20@mvs',
    minWidth: '280@ms',
    maxWidth: '80%',
  },
  description: {
    ...typography.body.medium,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.charcoal2,
    textAlign: 'center',
    marginBottom: '16@mvs',
    paddingHorizontal: '16@ms',
  },
  title: {
    ...typography.body.large,
    color: colors.black,
    textAlign: 'center',
    marginBottom: '10@mvs',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.lightGray2,
    borderRadius: '8@s',
    padding: '12@s',
    fontSize: '16@s',
    color: colors.black,
    marginBottom: '24@vs',
    marginHorizontal: '20@ms',
    backgroundColor: colors.lightGray,
  },
  inputFocused: {
    borderColor: colors.brightBlue,
  },
  buttonContainer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: colors.lightGray8,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: '14@mvs',
    paddingHorizontal: '14@ms',
    borderBottomLeftRadius: '8@ms',
    alignItems: 'center',
    borderRightWidth: 1,
    borderColor: colors.lightGray8,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: '12@mvs',
    paddingHorizontal: '14@ms',
    borderBottomRightRadius: '8@ms',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: '14@ms',
    fontWeight: '500',
  },
});
