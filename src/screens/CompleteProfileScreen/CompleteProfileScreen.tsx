import React, {useCallback, useState} from 'react';
import {Alert, SafeAreaView, Text, TextInput, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {isIOS} from '@/constants/general';
import {useAppNavigation, useTranslate} from '@/hooks';
import {useCompleteProfileMutation} from '@/services/authApi';
import {colors} from '@/theme';
import {getErrorDetails} from '@/utils';

/**
 * First-login gate for accounts created in bulk by an admin (no name yet).
 * The user fills in their name (and optionally phone) before entering the app;
 * completing it flips profileCompleted server-side and we re-run auth routing.
 */
export const CompleteProfileScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const {t} = useTranslate();
  const [name, setName] = useState('');
  const [isNameFocused, setIsNameFocused] = useState(false);
  const [completeProfile, {isLoading}] = useCompleteProfileMutation();

  const isNameValid = name.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!isNameValid) return;
    try {
      await completeProfile({name: name.trim()}).unwrap();
      // Re-enter the auth routing flow now that the profile is complete.
      navigation.reset({index: 0, routes: [{name: SCREEN_NAMES.SPLASH}]});
    } catch (err) {
      const message = getErrorDetails(err).message;
      Alert.alert(
        t('completeProfile.errorTitle'),
        message || t('completeProfile.errorDescription'),
      );
    }
  }, [completeProfile, isNameValid, name, navigation, t]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAwareScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        enableAutomaticScroll={!isIOS}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.headerText}>{t('completeProfile.title')}</Text>
        <Text style={styles.subtitle}>{t('completeProfile.subtitle')}</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>
            {t('completeProfile.nameLabel')}
          </Text>
          <TextInput
            style={[styles.input, isNameFocused && styles.inputFocused]}
            value={name}
            onChangeText={setName}
            placeholder={t('completeProfile.namePlaceholder')}
            placeholderTextColor={colors.mediumGray}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
            onFocus={() => setIsNameFocused(true)}
            onBlur={() => setIsNameFocused(false)}
            editable={!isLoading}
          />
          <Button
            label={t('completeProfile.submit')}
            onPress={handleSubmit}
            isDisabled={!isNameValid}
            isLoading={isLoading}
          />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: '24@ms',
  },
  headerText: {
    fontSize: '24@ms',
    fontWeight: '600',
    color: colors.darkGray2,
    marginBottom: '8@vs',
  },
  subtitle: {
    fontSize: '14@ms',
    color: colors.mediumGray,
    marginBottom: '24@vs',
  },
  inputContainer: {
    gap: '12@vs',
  },
  inputLabel: {
    fontSize: '14@ms',
    color: colors.darkGray2,
  },
  input: {
    borderWidth: '1@ms',
    borderColor: colors.ashGray,
    borderRadius: '12@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '12@vs',
    fontSize: '16@ms',
    color: colors.darkGray2,
  },
  inputFocused: {
    borderColor: colors.darkGray2,
  },
});
