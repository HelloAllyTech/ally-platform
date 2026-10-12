import React, {useState} from 'react';
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
 * In-place view of a trainer-curated external resource, opened from an
 * article's Resources list. Loads the page directly in a WebView so the
 * learner never leaves the course — but many real sites (Wikipedia, most
 * news sites, many docs) block iframe-style embedding via X-Frame-Options/
 * CSP, and a blocked load renders blank with no distinguishable error. The
 * "open externally" action in the header stays visible at all times rather
 * than only appearing on a failure we cannot reliably detect.
 */
export const ExternalResourceSheet: React.FC<ExternalResourceSheetProps> = ({
  resource,
  onClose,
}) => {
  const {t} = useTranslate();
  const [loading, setLoading] = useState(true);

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
            onLoadEnd={() => setLoading(false)}
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
