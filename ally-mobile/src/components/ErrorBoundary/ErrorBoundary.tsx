import {Component, ErrorInfo, ReactNode} from 'react';
import crashlytics from '@react-native-firebase/crashlytics';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';
import {logger} from '@/utils/logger';

import {Button} from '../Button/Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

const ErrorFallback = ({onReset}: {onReset: () => void}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('common.somethingWentWrong')}</Text>
      <Text style={styles.description}>{t('common.unexpectedErrorDesc')}</Text>
      <Button
        label={t('common.offline.tryAgain')}
        onPress={onReset}
        customContainerStyle={styles.button}
        testID="error-boundary-retry"
      />
    </View>
  );
};

/**
 * Catches render errors anywhere below it and offers a way back.
 *
 * Without this, a single bad render left the app on a blank, permanently
 * unresponsive screen — the counsellor's only option was to force-quit — and
 * nothing was recorded anywhere: `logger` is a no-op outside development, and
 * Crashlytics was only seeing native crashes, never JS ones. Reporting the error
 * here is what makes this class of failure visible at all.
 *
 * Resetting re-mounts the navigator, which lands the counsellor back at the start
 * of the app rather than on the screen that just failed.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): ErrorBoundaryState {
    return {hasError: true};
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(`Unhandled render error: ${error.message}`);

    // Reporting must never be the reason the fallback fails to show.
    try {
      crashlytics().log(
        `componentStack: ${errorInfo.componentStack ?? 'unavailable'}`,
      );
      crashlytics().recordError(error, 'UnhandledRenderError');
    } catch (reportingError) {
      logger.error(`Failed to report render error: ${reportingError}`);
    }
  }

  handleReset = () => {
    this.setState({hasError: false});
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '24@s',
    backgroundColor: colors.white,
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '20@ms',
    color: colors.darkGray12,
    textAlign: 'center',
    marginBottom: '10@vs',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@ms',
    color: colors.darkGray16,
    textAlign: 'center',
    marginBottom: '24@vs',
  },
  button: {
    width: '60%',
  },
});
