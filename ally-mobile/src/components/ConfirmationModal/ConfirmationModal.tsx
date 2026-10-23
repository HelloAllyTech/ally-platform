import React, {type ComponentType} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import type {SvgProps} from 'react-native-svg';

import {CloseIcon} from '@/assets';
import {Button} from '@/components';
import {
  colors,
  fontFamily,
  fontWeights,
  typography,
  typographyColors,
} from '@/theme';

import type {ButtonVariant} from '../Button/types';

export interface ConfirmationModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Callback when the modal is closed (close button or cancel) */
  onClose: () => void;
  /** Callback when the confirm button is pressed */
  onConfirm: () => void;
  /** Optional icon displayed above the header */
  Icon?: ComponentType<SvgProps>;
  /** Title text displayed in the header */
  title: string;
  /** Optional subtitle displayed next to the title */
  subtitle?: string;
  /** Description text displayed below the header */
  description: string;
  /** Label for the confirm button */
  confirmLabel: string;
  /** Label for the cancel button */
  cancelLabel: string;
  /** Variant for the confirm button (defaults to 'primary') */
  confirmVariant?: ButtonVariant;
  /** Whether the confirm button is in a loading state */
  isLoading?: boolean;
}

export const ConfirmationModal = React.memo(
  ({
    visible,
    onClose,
    onConfirm,
    Icon,
    title,
    subtitle,
    description,
    confirmLabel,
    cancelLabel,
    confirmVariant = 'primary',
    isLoading = false,
  }: ConfirmationModalProps) => {
    if (!visible) return null;

    return (
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.overlay}>
          <View style={styles.container}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <CloseIcon />
            </TouchableOpacity>
            {Icon ? (
              <View style={styles.iconContainer}>
                <Icon />
              </View>
            ) : null}
            <View style={styles.header}>
              <Text style={styles.title}>{title} </Text>
              {subtitle ? (
                <Text style={styles.subtitle}>{subtitle}</Text>
              ) : null}
            </View>
            <Text style={styles.description}>{description}</Text>
            <View style={styles.buttonContainer}>
              <Button
                label={cancelLabel}
                onPress={onClose}
                variant="secondary"
                customContainerStyle={styles.button}
              />
              <Button
                label={confirmLabel}
                onPress={onConfirm}
                variant={confirmVariant}
                customContainerStyle={styles.button}
                isLoading={isLoading}
              />
            </View>
          </View>
        </View>
      </View>
    );
  },
);

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(19, 19, 19, 0.37)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    zIndex: 9999,
  },
  container: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    padding: '16@s',
    maxWidth: '80%',
    alignItems: 'center',
    gap: '10@ms',
  },
  closeButton: {
    position: 'absolute',
    top: '8@ms',
    right: '8@ms',
    width: '24@ms',
    height: '24@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: '4@ms',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginBottom: '10@mvs',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    ...typography.body.large,
  },
  subtitle: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    color: colors.darkGray12,
    ...typography.body.large,
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: typographyColors.mediumEmphasis,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    textAlign: 'center',
    marginBottom: '10@mvs',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: '12@ms',
    width: '100%',
  },
  button: {
    flex: 1,
  },
});
