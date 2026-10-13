import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import WebView from 'react-native-webview';

import {BottomSheet} from '@/components/BottomSheet';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {ArticleResource} from '@/types';

interface ExternalResourceSheetProps {
  resource: ArticleResource;
  onClose: () => void;
}

/**
 * How long to wait for the WebView to finish loading before giving up on the
 * embed and handing off to the OS instead. A WebView that never calls back at
 * all (e.g. a destination stuck behind a bot/CAPTCHA challenge triggered by
 * the embed's cookie-less, non-browser-looking request — a real pattern once
 * a site's WAF notices it) looks identical, from here, to one still loading,
 * so a timeout is the only way to stop waiting on it.
 */
const EMBED_TIMEOUT_MS = 8000;

/**
 * In-place view of a trainer-curated external resource, opened from an
 * article's Resources list. Loads the page directly in a WebView so the
 * learner never leaves the course. Two distinct failure signals are handled
 * differently: `onError`/`onHttpError` are genuine, reliable failures (DNS,
 * connection refused, a 4xx/5xx status) and fall back immediately; a WebView
 * that simply never finishes loading (the common shape of an X-Frame-Options/
 * CSP block, or a stalled bot-challenge) gets the timeout instead, since
 * nothing fires to react to otherwise. The "open externally" action in the
 * header stays visible throughout as the manual way out of the one case
 * neither of those catches: a destination that *does* finish loading, inside
 * the WebView, but shows a challenge page instead of the real content —
 * genuinely indistinguishable from a real page load without reading the
 * loaded content, which the WebView never exposes.
 */
export const ExternalResourceSheet: React.FC<ExternalResourceSheetProps> = ({
  resource,
  onClose,
}) => {
  const {t} = useTranslate();
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      Linking.openURL(resource.url);
      onClose();
    }, EMBED_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Intentionally only re-arms if the resource itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.url]);

  const handleLoadEnd = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLoading(false);
  };

  const handleFailure = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    Linking.openURL(resource.url);
    onClose();
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      initialSnapPoint={85}
      enableDynamicSizing={false}
      backgroundColor={colors.white}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {resource.title}
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(resource.url)}
            accessibilityRole="button"
            testID="external-resource-open-externally">
            <Text style={styles.openExternally}>
              {t('courses.article.openExternally')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.webviewContainer}>
          {loading && (
            <View style={styles.loading} testID="external-resource-loading">
              <ActivityIndicator size="large" color={colors.ds.theme.primary} />
            </View>
          )}
          <WebView
            testID="external-resource-webview"
            source={{uri: resource.url}}
            style={styles.webview}
            onLoadEnd={handleLoadEnd}
            onError={handleFailure}
            onHttpError={handleFailure}
          />
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12@ms',
    paddingHorizontal: '16@ms',
    paddingBottom: '12@mvs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    flex: 1,
  },
  openExternally: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.theme.primary,
  },
  webviewContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    zIndex: 1,
  },
});
