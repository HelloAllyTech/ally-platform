import {useCallback} from 'react';
import {Alert} from 'react-native';
import {openSettings} from 'react-native-permissions';

import {useTranslate} from '@/hooks/useTranslate';
import {TranslationType} from '@/localization/locales/type';

interface SettingsAlertOptions {
  cancelKey?: TranslationType;
  settingsKey?: TranslationType;
  onCancel?: () => void;
  onOpenSettings?: () => void;
}

export const usePermissionAlert = () => {
  const {t} = useTranslate();

  const showSettingsAlert = useCallback(
    (
      titleKey: TranslationType,
      messageKey: TranslationType,
      options?: SettingsAlertOptions,
    ) => {
      Alert.alert(t(titleKey), t(messageKey), [
        {
          text: t(options?.cancelKey || 'Common.cancel'),
          style: 'cancel',
          onPress: options?.onCancel,
        },
        {
          text: t(options?.settingsKey || 'Common.permissions.openSettings'),
          onPress:
            options?.onOpenSettings ||
            (() => {
              openSettings();
            }),
        },
      ]);
    },
    [t],
  );

  const showMicrophoneSettingsAlert = useCallback(() => {
    showSettingsAlert(
      'Common.permissions.microphoneRequired',
      'Common.permissions.microphoneMessage',
    );
  }, [showSettingsAlert]);

  return {showSettingsAlert, showMicrophoneSettingsAlert};
};
