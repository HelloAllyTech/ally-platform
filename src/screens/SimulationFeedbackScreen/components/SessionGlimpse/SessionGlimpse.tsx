import React, {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronDown} from '@/assets';
import {colors, fontFamily} from '@/theme';

interface SessionGlimpseProps {
  content?: string;
}

export const SessionGlimpse: React.FC<SessionGlimpseProps> = ({content}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Dummy content for now
  const glimpseContent =
    content ||
    "During the session, the exhibited signs of unease, such as fidgeting and glancing away from the camera. As they spoke, Kai revealed feelings of stagnation and worry about future prospects. The counselor acknowledged Kai's concerns with empathy. They explored past experiences, discovering moments of strength that seemed to spark a hint of optimism in Kai. By the end, Kai seemed more open to discussing achievable steps toward positive change, showing renewed hope.";

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
          <ChevronDown
            width={16}
            height={16}
            color={colors.ds.typography.mediumEmphasis}
          />
        </View>
        <Text style={styles.headerText}>Session glimpse</Text>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.contentContainer}>
          <Text style={styles.contentText}>{glimpseContent}</Text>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    borderWidth: '0.5@ms',
    borderColor: '#C8C5D0', // Match web border color
    marginBottom: '16@vs',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '8@vs',
    paddingHorizontal: '16@ms',
    backgroundColor: '#EDE7F680', // Match web background with opacity
  },
  iconContainer: {
    marginRight: '8@ms',
    transform: [{rotate: '0deg'}],
  },
  iconContainerExpanded: {
    transform: [{rotate: '180deg'}],
  },
  headerText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    color: colors.ds.typography.highEmphasis,
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: '16@ms',
    paddingVertical: '16@vs',
    paddingTop: '8@vs',
    backgroundColor: colors.white,
  },
  contentText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
});
