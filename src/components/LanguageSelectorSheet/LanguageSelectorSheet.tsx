import React, {useCallback} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FlatList,
  I18nManager,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {BottomSheet} from '@/components/BottomSheet';
import {AsyncStorageKeys} from '@/constants';
import {useTranslate} from '@/hooks/useTranslate';
import i18n from '@/localization/i18n';
import {api} from '@/services/api';
import {store} from '@/store/store';
import {colors, fontFamily, typography} from '@/theme';

const LANGUAGE_OPTIONS = [
  {code: 'en', label: 'English'},
  {code: 'hi', label: 'हिंदी'},
  {code: 'mr', label: 'मराठी'},
  {code: 'ta', label: 'தமிழ்'},
  {code: 'kn', label: 'ಕನ್ನಡ'},
] as const;

type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]['code'];

const RTL_LANGS = new Set<string>(['ar', 'fa', 'ur', 'he']);

export const getLabelFromCode = (code: string): string =>
  LANGUAGE_OPTIONS.find(o => o.code === code)?.label ?? 'English';

interface LanguageSelectorSheetProps {
  visible: boolean;
  onClose: () => void;
}

export const LanguageSelectorSheet: React.FC<LanguageSelectorSheetProps> = ({
  visible,
  onClose,
}) => {
  const {t} = useTranslate();
  const currentCode = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  const handleSelect = useCallback(
    async (code: LanguageCode) => {
      await i18n.changeLanguage(code);
      try {
        await AsyncStorage.setItem(AsyncStorageKeys.UI_LANGUAGE, code);
      } catch {
        // Silent — i18n still works, preference just won't persist across cold restarts
      }
      I18nManager.forceRTL(RTL_LANGS.has(code));
      // languageCode is injected below RTK Query's cache (see api.ts), so cached
      // content won't auto-refetch on a language switch. Reset the API cache to
      // force localized refetches. Auth tokens live in userSlice/AsyncStorage,
      // so they are unaffected.
      store.dispatch(api.util.resetApiState());
      onClose();
    },
    [onClose],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={45}
      allowFullExpand={false}
      backgroundColor={colors.white}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('languageSelector.title')}</Text>
        <FlatList
          data={LANGUAGE_OPTIONS}
          keyExtractor={item => item.code}
          scrollEnabled={false}
          renderItem={({item}) => {
            const isSelected = item.code === currentCode;
            return (
              <TouchableOpacity
                style={styles.option}
                onPress={() => void handleSelect(item.code)}
                activeOpacity={0.7}>
                <Text
                  style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                  ]}>
                  {item.label}
                </Text>
                {isSelected && <View style={styles.selectedDot} />}
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </BottomSheet>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingHorizontal: '16@ms',
    paddingBottom: '24@mvs',
  },
  title: {
    ...typography.label.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '16@mvs',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: '14@mvs',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
  },
  optionText: {
    ...typography.body.large,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
  },
  optionTextSelected: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
  },
  selectedDot: {
    width: '8@ms',
    height: '8@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.brand.logo,
  },
});
