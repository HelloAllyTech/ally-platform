import {forwardRef, useImperativeHandle, useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {InfoBlackCircleIcon} from '@/assets/icons';
import {colors, fontFamily, typography} from '@/theme';

interface ScenarioInfoOverlayProps {
  title: string;
  triggerWarnings?: string[];
}

export interface ScenarioInfoOverlayRef {
  close: () => void;
  isOpen: boolean;
}

export const ScenarioInfoOverlay = forwardRef<
  ScenarioInfoOverlayRef,
  ScenarioInfoOverlayProps
>(({title, triggerWarnings}, ref) => {
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
          {triggerWarnings && triggerWarnings.length > 0 && (
            <View style={styles.triggerWarningContainer}>
              <Text style={styles.triggerWarningText}>
                {triggerWarnings.map((warning, index) => (
                  <Text key={index}>
                    {warning}
                    {index < triggerWarnings.length - 1 && (
                      <Text style={styles.separator}> • </Text>
                    )}
                  </Text>
                ))}
              </Text>
            </View>
          )}
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
    marginBottom: '4@ms',
  },
  triggerWarningContainer: {
    marginTop: '2@ms',
  },
  triggerWarningText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasisLight,
  },
  separator: {
    color: colors.ds.stroke.primary,
  },
});
