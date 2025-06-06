import {useCallback} from 'react';
import {Alert, Linking, Text, TouchableOpacity, View} from 'react-native';

import {env} from '@/config/env';
import {DEFAULT_HIT_SLOP} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {logger} from '@/utils/logger';

import {styles} from './styles';

export const FeatureNotAvailable = () => {
  const {t} = useTranslate();

  const handleLearnMorePress = useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(env.ALLY_WEB_URL);
      if (supported) {
        await Linking.openURL(env.ALLY_WEB_URL);
      } else {
        Alert.alert('Error', 'Unable to open the link');
      }
    } catch (error) {
      logger.error(`Error opening learn more URL: ${error}`);
      Alert.alert('Error', 'Unable to open the link');
    }
  }, []);

  return (
    <View style={styles.clientContainer}>
      <Text style={styles.oopsText}>{t('Home.client.oops')}</Text>
      <View style={styles.messageContainer}>
        <Text style={styles.messageText}>
          {t('Home.client.appCurrentlyFor')}
        </Text>
        <Text style={styles.messageText}>
          {t('Home.client.counselorsOnly')}
        </Text>
      </View>
      <TouchableOpacity
        onPress={handleLearnMorePress}
        style={styles.learnMoreButton}
        hitSlop={DEFAULT_HIT_SLOP}>
        <Text style={styles.learnMoreText}>{t('Home.client.learnMore')}</Text>
      </TouchableOpacity>
    </View>
  );
};
