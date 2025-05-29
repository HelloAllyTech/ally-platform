import React, {useCallback} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {Linking, Text, View} from 'react-native';

import {useAppNavigation} from '@/hooks/useAppNavigation';

export const CommunityScreen: React.FC = () => {
  const navigation = useAppNavigation();
  useFocusEffect(
    useCallback(() => {
      navigation.goBack();

      //Open community
      const url = 'https://community.helloally.ai/';
      Linking.canOpenURL(url).then(supported => {
        if (supported) {
          Linking.openURL(url);
        }
      });
    }, [navigation]),
  );

  return (
    <View>
      <Text>Community</Text>
    </View>
  );
};
