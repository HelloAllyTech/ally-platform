import {useCallback} from 'react';
import {NavigationState, useNavigationState} from '@react-navigation/native';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {Button} from '@/components';
import {useAppNavigation, useBugReport, useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, stroke, typography} from '@/theme';

const isIOS = Platform.OS === 'ios';

type RouteWithNestedState = NavigationState['routes'][number];

// A route reached through the Drawer/BottomTabs subtree is registered on the
// root Stack under one shared route name, with the actual screen nested
// several navigators deeper. Walk down to the innermost active route to find it.
const getDeepestActiveRouteName = (
  route?: RouteWithNestedState,
): string | undefined => {
  let current = route;
  let name = current?.name;

  while (current?.state?.routes?.length) {
    const nested = current.state as NavigationState;
    const activeRoute = nested.routes[nested.index ?? nested.routes.length - 1];
    if (!activeRoute) break;
    name = activeRoute.name;
    current = activeRoute;
  }

  return name;
};

export const BugReportScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();

  // The screen the user was on right before opening this one — captured
  // silently as diagnostic context, never shown in the UI.
  const previousScreenName = useNavigationState(state => {
    const routes = state?.routes ?? [];
    return getDeepestActiveRouteName(routes[routes.length - 2]);
  });

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const {
    description,
    setDescription,
    isSubmitting,
    canSubmit,
    maxLength,
    handleSubmit,
  } = useBugReport({
    screen: previousScreenName,
    onSuccess: handleGoBack,
  });

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleGoBack}
          testID="bug-report-back-button">
          <LeftArrowIcon color={colors.black} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('bugReport.title')}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={isIOS ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.prompt}>{t('bugReport.prompt')}</Text>
          <TextInput
            style={styles.textArea}
            value={description}
            onChangeText={setDescription}
            placeholder={t('bugReport.placeholder')}
            placeholderTextColor={colors.ds.typography.lowEmphasis}
            multiline
            numberOfLines={6}
            maxLength={maxLength}
            textAlignVertical="top"
            editable={!isSubmitting}
            testID="bug-report-input"
          />
          <Text style={styles.charCount}>
            {description.length}/{maxLength}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Button
          label={t('bugReport.submit')}
          onPress={handleSubmit}
          isDisabled={!canSubmit}
          isLoading={isSubmitting}
          testID="bug-report-submit-button"
        />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '16@ms',
    paddingVertical: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
  },
  backButton: {
    marginRight: '16@ms',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    fontWeight: fontWeights.light,
    textAlign: 'left',
    color: colors.ds.typography.highEmphasis,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: '24@ms',
    paddingTop: '24@mvs',
  },
  prompt: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '12@mvs',
  },
  textArea: {
    width: '100%',
    minHeight: '160@vs',
    borderWidth: 0.5,
    borderColor: stroke.primary,
    borderRadius: '8@ms',
    padding: '12@ms',
    backgroundColor: colors.white,
    ...typography.body.medium,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.black,
  },
  charCount: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.lowEmphasis,
    textAlign: 'right',
    marginTop: '8@mvs',
  },
  footer: {
    paddingHorizontal: '24@ms',
    paddingBottom: '24@mvs',
    paddingTop: '16@mvs',
  },
});
