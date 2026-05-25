import React from 'react';
import {AppleButton} from '@invertase/react-native-apple-authentication';
import {ActivityIndicator, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, radius} from '@/theme';

import type {ButtonProps} from './types';

type AppleLoginButtonProps = Omit<ButtonProps, 'label'>;

export const AppleLoginButton: React.FC<AppleLoginButtonProps> = ({
  isDisabled,
  isLoading,
  onPress,
  ...rest
}) => {
  if (isLoading) {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        {...rest}
        style={styles.loadingButton}
        disabled>
        <ActivityIndicator color={colors.ds.neutral.white} />
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={[styles.container, isDisabled && styles.disabled]}
      pointerEvents={isDisabled ? 'none' : 'auto'}
      {...rest}>
      <AppleButton
        buttonStyle={AppleButton.Style.BLACK}
        buttonType={AppleButton.Type.CONTINUE}
        cornerRadius={radius.full}
        style={styles.appleButton}
        onPress={onPress}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    marginBottom: '10@vs',
  },
  appleButton: {
    width: '100%',
    height: '46@vs',
  },
  disabled: {
    opacity: 0.6,
  },
  loadingButton: {
    width: '100%',
    height: '46@vs',
    backgroundColor: colors.ds.neutral.black,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
    marginBottom: '10@vs',
  },
});
