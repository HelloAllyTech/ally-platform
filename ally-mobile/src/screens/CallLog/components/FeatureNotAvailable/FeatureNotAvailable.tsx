import {StyleProp, Text, TextStyle, TouchableOpacity, View} from 'react-native';

import {DEFAULT_HIT_SLOP} from '@/constants/general';
import {useTranslate} from '@/hooks';

import {styles} from './styles';

interface FeatureNotAvailableProps {
  title?: string;
  description: string;
  ctaText?: string;
  onCtaPress?: () => void;
  containerStyle?: StyleProp<TextStyle>;
}

export const FeatureNotAvailable = ({
  title,
  description,
  ctaText,
  onCtaPress,
  containerStyle,
}: FeatureNotAvailableProps) => {
  const {t} = useTranslate();

  return (
    <View style={[styles.clientContainer, containerStyle]}>
      <Text style={styles.oopsText}>{title || t('audioCall.error.oops')}</Text>
      <View style={styles.messageContainer}>
        <Text style={styles.messageText}>{description}</Text>
      </View>
      {!!ctaText && !!onCtaPress && (
        <TouchableOpacity
          onPress={onCtaPress}
          style={styles.learnMoreButton}
          hitSlop={DEFAULT_HIT_SLOP}>
          <Text style={styles.learnMoreText}>{ctaText}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
