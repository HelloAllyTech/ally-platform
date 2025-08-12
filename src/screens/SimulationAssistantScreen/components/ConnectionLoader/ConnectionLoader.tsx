import React from 'react';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

interface ConnectionLoaderProps {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string | null;
  onRetry?: () => void;
  onGoBack?: () => void;
  maxRetriesReached?: boolean;
}

export const ConnectionLoader: React.FC<ConnectionLoaderProps> = ({
  status,
  error,
  onRetry,
  onGoBack,
  maxRetriesReached = false,
}) => {
  if (status === 'connected' || status === 'idle') {
    return null;
  }

  const isInvalidTokenError = (errorMessage: string) => {
    const invalidTokenKeywords = [
      'invalid token',
      'unauthorized',
      'authentication failed',
      'token expired',
      'invalid access token',
      'missing token',
      'Invalid WebSocket URL or missing token',
      'No room provided',
      'room context',
    ];

    return invalidTokenKeywords.some(keyword =>
      errorMessage.toLowerCase().includes(keyword.toLowerCase()),
    );
  };

  const getStatusMessage = () => {
    // If we have an error and it's an invalid token error, show failed message immediately
    if (error && isInvalidTokenError(error)) {
      return 'Failed to connect';
    }

    switch (status) {
      case 'connecting':
        return 'Connecting to session...';
      case 'error':
        return maxRetriesReached ? 'Unable to connect' : 'Connection failed';
      case 'disconnected':
        return 'Disconnected from session';
      default:
        return 'Connecting...';
    }
  };

  const getErrorDetails = () => {
    if (!error) return null;

    if (maxRetriesReached) {
      return "We're having trouble connecting to the session. Please check your internet connection and try again later.";
    }

    // Handle invalid token errors specifically
    if (isInvalidTokenError(error)) {
      return 'The provided token is invalid or has expired. Please check your token and try again.';
    }

    // Provide user-friendly error messages for other cases
    if (
      error.includes('Invalid WebSocket URL') ||
      error.includes('missing token')
    ) {
      return 'Please check your connection settings and try again.';
    }
    if (error.includes('network') || error.includes('timeout')) {
      return 'Network connection issue. Please check your internet connection.';
    }
    if (error.includes('unauthorized') || error.includes('token')) {
      return 'Authentication failed. Please try again.';
    }
    return error;
  };

  // Don't show loading spinner for invalid token errors
  const shouldShowLoading =
    status === 'connecting' && !(error && isInvalidTokenError(error));

  return (
    <View style={styles.container}>
      {shouldShowLoading && (
        <ActivityIndicator size="large" color={colors.azureBlue} />
      )}

      <Text style={styles.statusText}>{getStatusMessage()}</Text>

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{getErrorDetails()}</Text>
          {onRetry && status === 'error' && !maxRetriesReached && (
            <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          )}
          {maxRetriesReached && onGoBack && (
            <TouchableOpacity style={styles.backButton} onPress={onGoBack}>
              <Text style={styles.backButtonText}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    paddingHorizontal: '20@ms',
  },
  statusText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '16@ms',
    color: colors.black,
    marginTop: '16@mvs',
    textAlign: 'center',
    fontWeight: '500',
  },
  errorContainer: {
    alignItems: 'center',
    marginTop: '16@mvs',
  },
  errorText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.brightRed,
    textAlign: 'center',
    paddingHorizontal: '20@ms',
    lineHeight: '20@mvs',
  },
  retryButton: {
    backgroundColor: colors.azureBlue,
    paddingHorizontal: '24@ms',
    paddingVertical: '12@mvs',
    borderRadius: '8@ms',
    marginTop: '16@mvs',
  },
  retryButtonText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.white,
    fontWeight: '500',
  },
  backButton: {
    backgroundColor: colors.lightGray3,
    paddingHorizontal: '24@ms',
    paddingVertical: '12@mvs',
    borderRadius: '8@ms',
    marginTop: '16@ms',
  },
  backButtonText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
    fontWeight: '500',
  },
});
