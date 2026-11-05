import React from 'react';
import {BottomSheetScrollView} from '@gorhom/bottom-sheet';
import {ActivityIndicator, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {BottomSheet} from '@/components/BottomSheet';
import {useTranslate} from '@/hooks';
import {CourseProgressBody} from '@/screens/CourseProgressScreen/components/CourseProgressBody';
import {useGetLearnTrackProgressQuery} from '@/services';
import {colors, fontFamily, typography} from '@/theme';
import {TrackRoleplaySessionFeedback} from '@/types';

interface CourseProgressSheetProps {
  visible: boolean;
  onClose: () => void;
  trackId: string;
  onSessionPress: (session: TrackRoleplaySessionFeedback) => void;
  onContinuePress: () => void;
}

/**
 * In-context view of a course's progress + consolidated feedback, opened by
 * tapping the progress bar on CourseOverviewScreen. Shares CourseProgressBody
 * with the standalone CourseProgressScreen — same content, different chrome
 * (a sheet's own title instead of a full screen header).
 */
export const CourseProgressSheet: React.FC<CourseProgressSheetProps> = ({
  visible,
  onClose,
  trackId,
  onSessionPress,
  onContinuePress,
}) => {
  const {t} = useTranslate();

  const {
    data: dashboard,
    isLoading,
    error,
  } = useGetLearnTrackProgressQuery({trackId}, {skip: !trackId || !visible});

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={70}
      // CourseProgressBody's session list is potentially long; the scroll
      // view below is flex:1 and reports no height of its own, so dynamic
      // sizing must stay off (same reasoning as CallLogFilterSheet).
      enableDynamicSizing={false}
      backgroundColor={colors.white}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('courses.progressDashboard.title')}</Text>

        {isLoading ? (
          <ActivityIndicator
            size="large"
            color={colors.ds.theme.primary}
            style={styles.loadingContainer}
            testID="progress-sheet-loading"
          />
        ) : error || !dashboard ? (
          <Text style={styles.notFound}>
            {t('courses.progressDashboard.notFound')}
          </Text>
        ) : (
          // BottomSheetScrollView, not ScrollView — @gorhom/bottom-sheet only
          // yields its pan gesture to content that registers with it.
          <BottomSheetScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}>
            <CourseProgressBody
              dashboard={dashboard}
              onSessionPress={onSessionPress}
              onContinuePress={onContinuePress}
            />
          </BottomSheetScrollView>
        )}
      </View>
    </BottomSheet>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: '16@ms',
  },
  title: {
    ...typography.label.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '12@mvs',
  },
  loadingContainer: {
    paddingVertical: '32@ms',
  },
  notFound: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
    paddingVertical: '32@ms',
  },
  scroll: {
    flex: 1,
  },
});
