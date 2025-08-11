import React from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

interface ConnectionLoaderProps {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string | null;
}

export const ConnectionLoader: React.FC<ConnectionLoaderProps> = ({
  status,
  error,
}) => {
  if (status === 'connected' || status === 'idle') {
    return null;
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.azureBlue} />
      <Text style={styles.statusText}>
        {status === 'connecting' && 'Connecting to session...'}
        {status === 'error' && 'Connection failed'}
        {status === 'disconnected' && 'Disconnected'}
      </Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  statusText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '16@ms',
    color: colors.black,
    marginTop: '16@mvs',
    textAlign: 'center',
    fontWeight: '500',
  },
  errorText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.brightRed,
    marginTop: '8@mvs',
    textAlign: 'center',
    paddingHorizontal: '20@ms',
  },
});
