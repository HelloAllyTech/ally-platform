import {StyleProp, Text, TextStyle, View, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {colors, fontFamily} from '@/theme';

export interface ActionButton {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  isLoading?: boolean;
  customContainerStyle?: StyleProp<ViewStyle>;
  customTextStyle?: StyleProp<TextStyle>;
}

export interface IllustratedActionModalProps {
  visible: boolean;
  titleMain: string;
  titleItalic?: string;
  description: string;
  illustration: React.ReactNode;
  actions: ActionButton[];
}

export const IllustratedActionModal: React.FC<IllustratedActionModalProps> = ({
  visible,
  titleMain,
  titleItalic,
  description,
  illustration,
  actions,
}) => {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.modalContainer}>
        <Text style={styles.title}>
          <Text style={styles.marginRight8}>{titleMain} </Text>
          {titleItalic && <Text style={styles.titleItalic}>{titleItalic}</Text>}
        </Text>

        <View style={styles.illustrationContainer}>{illustration}</View>

        <Text style={styles.description}>{description}</Text>

        <View style={styles.actionsRow}>
          {actions.map((action, index) => (
            <Button
              key={index}
              onPress={action.onPress}
              label={action.label}
              isLoading={action.isLoading}
              customContainerStyle={[
                action.variant === 'secondary'
                  ? styles.secondaryButton
                  : styles.primaryButton,
                action.customContainerStyle,
              ]}
              customTextStyle={[
                action.variant === 'secondary'
                  ? styles.secondaryText
                  : styles.primaryText,
                action.customTextStyle,
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.blackTransparent50,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    zIndex: 1000,
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    padding: '16@s',
    minWidth: '280@ms',
    maxWidth: '80%',
    alignItems: 'center',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '20@ms',
    textAlign: 'center',
    marginBottom: '16@mvs',
    marginTop: '8@mvs',
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  marginRight8: {
    marginRight: '8@ms',
  },
  illustrationContainer: {
    marginBottom: '20@mvs',
    alignItems: 'center',
    width: '100%',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.black,
    textAlign: 'center',
    marginBottom: '16@mvs',
    lineHeight: '20@mvs',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: '12@ms',
    width: '100%',
  },
  secondaryButton: {
    width: '50%',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.lightGrayD9,
  },
  primaryButton: {
    width: '50%',
    backgroundColor: colors.azureBlue,
    borderRadius: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: colors.white,
  },
  secondaryText: {
    color: colors.charcoalGray,
  },
});
