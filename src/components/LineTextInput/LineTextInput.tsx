import {
  StyleProp,
  TextInput,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets';
import {colors, fontFamily, typography} from '@/theme';

interface LineTextInputProps {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  multiline?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  showSendButton?: boolean;
  onSend?: () => void;
  maxLength?: number;
}

export const LineTextInput: React.FC<LineTextInputProps> = ({
  placeholder,
  value,
  onChangeText,
  multiline = true,
  numberOfLines,
  style,
  showSendButton = false,
  onSend,
  containerStyle,
  maxLength,
}) => {
  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        numberOfLines={numberOfLines}
        style={[styles.input, style]}
        placeholder={placeholder}
        placeholderTextColor={colors.ds.typography.mediumEmphasis}
        maxLength={maxLength}
      />
      {showSendButton && (
        <TouchableOpacity style={styles.sendButton} onPress={onSend}>
          <LeftArrowIcon
            width={24}
            height={24}
            color={colors.ds.neutral.white}
            rotation={180}
          />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8@s',
    borderWidth: 0,
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
  },
  input: {
    flex: 1,
    padding: '12@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  sendButton: {
    padding: '12@ms',
    width: '32@ms',
    height: '32@ms',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '100@ms',
    backgroundColor: colors.ds.theme.primary,
  },
});
