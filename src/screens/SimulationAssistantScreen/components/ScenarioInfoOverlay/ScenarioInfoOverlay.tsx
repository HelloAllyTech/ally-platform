import {forwardRef, useImperativeHandle, useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {InfoBlackCircleIcon} from '@/assets/icons';
import {colors, fontFamily} from '@/theme';

interface ScenarioInfoOverlayProps {
  title: string;
}

export interface ScenarioInfoOverlayRef {
  close: () => void;
  isOpen: boolean;
}

export const ScenarioInfoOverlay = forwardRef<
  ScenarioInfoOverlayRef,
  ScenarioInfoOverlayProps
>(({title}, ref) => {
  const [showInfo, setShowInfo] = useState(false);

  useImperativeHandle(ref, () => ({
    close: () => setShowInfo(false),
    isOpen: showInfo,
  }));

  if (!title) {
    return null;
  }

  const handleInfoPress = () => {
    setShowInfo(prev => !prev);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.infoIconOverlay}
        onPress={handleInfoPress}
        activeOpacity={0.7}>
        <InfoBlackCircleIcon />
      </TouchableOpacity>
      {showInfo && (
        <View style={styles.scenarioInfoPanel}>
          <Text style={styles.scenarioTitle} numberOfLines={3}>
            {title}
          </Text>
        </View>
      )}
    </>
  );
});

ScenarioInfoOverlay.displayName = 'ScenarioInfoOverlay';

const styles = ScaledSheet.create({
  infoIconOverlay: {
    position: 'absolute',
    top: '12@ms',
    left: '12@ms',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  scenarioInfoPanel: {
    position: 'absolute',
    top: '12@ms',
    left: '28@ms',

    backgroundColor: colors.ds.blackAlpha[900],
    borderRadius: '8@ms',
    paddingVertical: '10@ms',
    paddingHorizontal: '14@ms',
    marginLeft: '8@ms',
    marginRight: '35@ms',
    minWidth: '200@ms',
    maxWidth: '400@ms',
  },
  scenarioTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.white,
  },
});
