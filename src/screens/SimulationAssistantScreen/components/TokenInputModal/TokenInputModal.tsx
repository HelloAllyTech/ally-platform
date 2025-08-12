import React, {useState} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

interface TokenInputModalProps {
  visible: boolean;
  onTokenSubmit: (token: string) => void;
  onCancel: () => void;
}

export const TokenInputModal: React.FC<TokenInputModalProps> = ({
  visible,
  onTokenSubmit,
  onCancel,
}) => {
  const [token, setToken] = useState('');

  const handleSubmit = () => {
    if (!token.trim()) {
      Alert.alert('Error', 'Please enter a valid token');
      return;
    }
    onTokenSubmit(token.trim());
    setToken(''); // Reset token after submission
  };

  const handleCancel = () => {
    setToken(''); // Reset token on cancel
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalContainer}>
          <View style={styles.content}>
            <Text style={styles.title}>Enter LiveKit Token</Text>
            <Text style={styles.description}>
              Please enter your LiveKit access token to connect to the
              simulation session.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Paste your LiveKit token here"
              placeholderTextColor={colors.lightGray3}
              value={token}
              onChangeText={setToken}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
            />

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancel}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmit}>
                <Text style={styles.submitButtonText}>Connect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    maxWidth: '400@ms',
  },
  content: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    padding: '24@ms',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '20@ms',
    color: colors.black,
    textAlign: 'center',
    marginBottom: '12@mvs',
  },
  description: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
    textAlign: 'center',
    marginBottom: '20@mvs',
    lineHeight: '20@mvs',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.lightGray3,
    borderRadius: '8@ms',
    padding: '12@ms',
    fontSize: '14@ms',
    color: colors.black,
    backgroundColor: colors.white,
    minHeight: '80@mvs',
    marginBottom: '24@mvs',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: '12@ms',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.lightGray3,
    paddingVertical: '12@mvs',
    borderRadius: '8@ms',
    alignItems: 'center',
  },
  cancelButtonText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
    fontWeight: '500',
  },
  submitButton: {
    flex: 1,
    backgroundColor: colors.azureBlue,
    paddingVertical: '12@mvs',
    borderRadius: '8@ms',
    alignItems: 'center',
  },
  submitButtonText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.white,
    fontWeight: '500',
  },
});
