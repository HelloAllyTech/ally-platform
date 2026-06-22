import React, {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowRight} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, radius, typography} from '@/theme';

interface SessionGlimpseProps {
  content?: string;
}

export const SessionGlimpse: React.FC<SessionGlimpseProps> = ({content}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const {t} = useTranslate();
  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={toggleExpanded}
        activeOpacity={0.7}>
        <View
          style={[
            styles.iconContainer,
            isExpanded && styles.iconContainerExpanded,
          ]}>
          <ArrowRight
            width={6}
            height={6}
            color={colors.ds.typography.mediumEmphasis}
          />
        </View>
        <Text style={styles.headerText}>
          {t('callFeedback.sessionGlimpse')}
        </Text>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.contentContainer}>
          <Text style={styles.contentText}>{content}</Text>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    borderWidth: '0.5@ms',
    borderColor: colors.ds.deepPurple[800],
    marginBottom: '16@vs',
    overflow: 'hidden',
    borderRadius: radius.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '10@vs',
    paddingHorizontal: '24@ms',
    backgroundColor: colors.ds.deepPurpleAlpha[50],
  },
  iconContainer: {
    transform: [{rotate: '0deg'}],
    marginRight: '12@ms',
  },
  iconContainerExpanded: {
    transform: [{rotate: '90deg'}],
  },
  headerText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: '16@ms',
    paddingVertical: '12@vs',
    paddingTop: '10@vs',
    backgroundColor: colors.white,
  },
  contentText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});
