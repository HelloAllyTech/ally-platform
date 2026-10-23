import React, {useEffect, useState} from 'react';
import {TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

interface FlowSectionProps {
  flow: string;
}

export const FlowSection: React.FC<FlowSectionProps> = ({flow}) => {
  const [flowText, setFlowText] = useState(flow);

  useEffect(() => {
    setFlowText(flow);
  }, [flow]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.editableText}
        value={flowText}
        onChangeText={setFlowText}
        placeholder="Add a concern"
        numberOfLines={10}
        multiline
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingTop: '8@ms',
    paddingBottom: '6@ms',
  },
  editableText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.darkSlate,
    lineHeight: '26@ms',
  },
});
