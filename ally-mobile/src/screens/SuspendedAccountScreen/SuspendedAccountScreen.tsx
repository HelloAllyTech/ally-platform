import React from 'react';
import {SafeAreaView, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SuspendedAccountIcon} from '@/assets/icons';
import {EmptyState} from '@/components';
import {useAppNavigation, useTranslate} from '@/hooks';
import {colors} from '@/theme';

export const SuspendedAccountScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const {t} = useTranslate();

  const handleGoToLogin = () => {
    navigation.reset({
      index: 0,
      routes: [{name: 'Splash'}],
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <EmptyState
        icon={SuspendedAccountIcon}
        title={t('suspended.title')}
        description={
          t('suspended.description.line1') + t('suspended.description.line2')
        }
      />
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={handleGoToLogin}>
          <Text style={styles.buttonText}>{t('suspended.goToLogin')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyStateContainer: {
    justifyContent: 'center',
  },
  buttonContainer: {
    paddingHorizontal: '24@ms',
    paddingBottom: '32@vs',
  },
  button: {
    backgroundColor: colors.white,
    borderWidth: '1@ms',
    borderColor: colors.ashGray,
    borderRadius: '24@ms',
    paddingVertical: '10@vs',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '16@ms',
    marginHorizontal: '24@ms',
  },
  buttonText: {
    fontSize: '16@ms',
    fontWeight: '500',
    color: colors.darkGray2,
  },
});
