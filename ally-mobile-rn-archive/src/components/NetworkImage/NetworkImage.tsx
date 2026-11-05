import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  ImageStyle,
  StyleProp,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import {SvgUri, SvgXml} from 'react-native-svg';

import {colors} from '@/theme';

interface NetworkImageProps {
  imageUrl: string;
  width?: number;
  height?: number;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'contain' | 'cover' | 'stretch' | 'center';
}

/**
 * NetworkImage Component
 *
 * A component that handles rendering both regular image formats (PNG, JPG, etc.)
 * and SVG images from remote URLs. Automatically detects the image type based on
 * the URL extension and renders the appropriate component.
 *
 * For SVG URLs:
 * 1. First tries SvgUri (direct URL loading - works best with GCP signed URLs or public buckets)
 * 2. Falls back to fetch + SvgXml if SvgUri fails
 *
 * @param imageUrl - The URL of the image (can be PNG, JPG, SVG, etc.)
 * @param width - Width of the image (optional, uses style if not provided)
 * @param height - Height of the image (optional, uses style if not provided)
 * @param style - Additional styles for the image container
 * @param resizeMode - How to resize the image (only applies to regular images, not SVG)
 */
export const NetworkImage: React.FC<NetworkImageProps> = ({
  imageUrl,
  width,
  height,
  style,
  resizeMode = 'contain',
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [svgUriError, setSvgUriError] = useState(false);

  // Determine if the URL is an SVG based on the file extension
  const isSvg = imageUrl?.toLowerCase().endsWith('.svg');

  useEffect(() => {
    if (svgUriError) {
      setUseFallback(true);
    }
  }, [svgUriError]);

  useEffect(() => {
    // Reset states when URL changes
    setUseFallback(false);
    setSvgContent(null);
    setHasError(false);
    setIsLoading(true);
    setSvgUriError(false);
  }, [imageUrl]);

  useEffect(() => {
    // Only fetch if we need fallback (SvgUri failed)
    if (isSvg && useFallback && imageUrl) {
      setIsLoading(true);
      setHasError(false);
      setSvgContent(null);

      // Fetch SVG content from URL with proper headers
      fetch(imageUrl, {
        method: 'GET',
        headers: {
          Accept: 'image/svg+xml,image/*,*/*',
        },
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch SVG: ${response.status}`);
          }
          return response.text();
        })
        .then(text => {
          setSvgContent(text);
          setIsLoading(false);
        })
        .catch(() => {
          setHasError(true);
          setIsLoading(false);
        });
    }
  }, [imageUrl, isSvg, useFallback]);

  const handleLoadStart = () => {
    setIsLoading(true);
    setHasError(false);
  };

  const handleLoadEnd = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handleSvgUriError = () => {
    // SvgUri failed, try fetch fallback
    setSvgUriError(true);
  };

  if (hasError) {
    // Return a placeholder or empty view if image fails to load
    return <View style={[style, styles.error]} />;
  }

  return (
    <>
      {isLoading && (
        <View style={[style, styles.loading]}>
          <ActivityIndicator size="small" color={colors.ds.theme.primary} />
        </View>
      )}
      {isSvg ? (
        useFallback && svgContent ? (
          <SvgXml
            xml={svgContent}
            width={width || '100%'}
            height={height || '100%'}
          />
        ) : (
          <SvgUri
            uri={imageUrl}
            width={width || '100%'}
            height={height || '100%'}
            onLoad={handleLoadEnd}
            onError={handleSvgUriError}
          />
        )
      ) : (
        <Image
          source={{uri: imageUrl}}
          style={style}
          resizeMode={resizeMode}
          onLoadStart={handleLoadStart}
          onLoadEnd={handleLoadEnd}
          onError={handleError}
        />
      )}
    </>
  );
};

const styles = ScaledSheet.create({
  error: {
    backgroundColor: colors.ds.grey[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  loading: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
