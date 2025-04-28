import React from 'react';
import {View, Text, TouchableOpacity} from 'react-native';
import Config from 'react-native-config';
import {ScaledSheet, ms} from 'react-native-size-matters';

import type {RootStackScreenProps} from '@/navigation/types';

export const Home = ({navigation}: RootStackScreenProps<'Home'>) => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home Screen</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('Login')}>
        <Text style={styles.buttonText}>Go to Login</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: ms(24),
    marginBottom: ms(20),
  },
  button: {
    backgroundColor: '#007AFF',
    padding: ms(10),
    borderRadius: ms(5),
  },
  buttonText: {
    color: 'white',
    fontSize: ms(16),
  },
});
