import React, {useCallback} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {Linking, Text, View} from 'react-native';

import {useAppNavigation, useTabBackToHomeHandler} from '@/hooks';
import {useTranslate} from '@/hooks/useTranslate';

const url = 'https://community.helloally.ai/';

export const CommunityScreen: React.FC = () => {
  useTabBackToHomeHandler();
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  useFocusEffect(
    useCallback(() => {
      navigation.goBack();

      //Open community
      Linking.openURL(url);
    }, [navigation]),
  );

  return (
    <View>
      <Text>{t('community.title')}</Text>
    </View>
  );
};
