import React, {useEffect, useState} from 'react';
import {Image, Modal, Pressable, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Video from 'react-native-video';
import WebView from 'react-native-webview';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {QuestionMedia as QuestionMediaValue} from '@/types';

export interface QuestionMediaProps {
  media?: QuestionMediaValue;
}

/** Embeddable player URL for a third-party clip. Mirrors ally-web's parser. */
const embedUrlFor = (media: QuestionMediaValue): string | null => {
  const url = media.url.trim();
  const youtube = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/,
  );
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`;
  const vimeo = url.match(/(?:player\.)?vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const loom = url.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;
  return null;
};

/**
 * The picture or clip a question is asking about, rendered between the prompt
 * and the answer controls. Mirrors ally-web's `QuestionMedia`, and is shared
 * across the quiz player, the video-interjection modal and inline article
 * questions for the same reason: all three render the same sanitized
 * question.
 *
 * Nothing autoplays — the learner decides when a clip runs and can replay it
 * as often as they need. Tapping an image opens it full-screen, because
 * "what do you notice here" on a 180pt-tall thumbnail is the wrong
 * instrument, and a failed image says so in words instead of leaving a grey
 * rectangle that reads as a broken question.
 *
 * Unlike `VideoFallbackCard` — which sends third-party video out to the
 * browser — an embedded clip plays inline in a WebView here. That card's
 * constraint is the watch-percentage contract it has to honour and cannot
 * measure through an iframe; question media has no progress to report, so
 * the reason for the fallback does not apply and the learner keeps their
 * place in the quiz.
 */
export const QuestionMedia: React.FC<QuestionMediaProps> = ({media}) => {
  const {t} = useTranslate();
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setFailed(false);
  }, [media?.url]);

  if (!media?.url) return null;

  if (media.kind === 'image') {
    if (failed) {
      return (
        <View style={styles.failed} testID="question-media-failed">
          <Text style={styles.failedText}>
            {t('courses.question.media.imageFailed')}
          </Text>
          {!!media.alt && <Text style={styles.altText}>{media.alt}</Text>}
        </View>
      );
    }
    return (
      <>
        <Pressable
          testID="question-media-image"
          accessibilityRole="imagebutton"
          accessibilityLabel={
            media.alt || t('courses.question.media.viewLarger')
          }
          onPress={() => setExpanded(true)}
          style={styles.imageFrame}>
          <Image
            source={{uri: media.url}}
            style={styles.image}
            resizeMode="contain"
            onError={() => setFailed(true)}
          />
        </Pressable>
        <Modal
          visible={expanded}
          transparent
          animationType="fade"
          onRequestClose={() => setExpanded(false)}>
          <Pressable
            style={styles.lightbox}
            accessibilityRole="button"
            accessibilityLabel={t('courses.question.media.close')}
            onPress={() => setExpanded(false)}>
            <Image
              source={{uri: media.url}}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          </Pressable>
        </Modal>
      </>
    );
  }

  if (media.source === 's3') {
    return (
      <View style={styles.videoFrame}>
        <Video
          testID="question-media-video"
          source={{uri: media.url}}
          style={styles.video}
          resizeMode="contain"
          controls
          paused
          poster={media.posterUrl}
        />
      </View>
    );
  }

  const embedUrl = embedUrlFor(media);
  if (!embedUrl) return null;
  return (
    <View style={styles.videoFrame}>
      <WebView
        testID="question-media-embed"
        source={{uri: embedUrl}}
        style={styles.video}
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  imageFrame: {
    width: '100%',
    height: '180@ms',
    marginBottom: '16@ms',
    borderRadius: '12@ms',
    overflow: 'hidden',
    backgroundColor: colors.ds.surface.surfaceVariant,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16@ms',
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
  videoFrame: {
    width: '100%',
    aspectRatio: 16 / 9,
    marginBottom: '16@ms',
    borderRadius: '12@ms',
    overflow: 'hidden',
    backgroundColor: colors.black,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  failed: {
    marginBottom: '16@ms',
    padding: '12@ms',
    borderRadius: '12@ms',
    backgroundColor: colors.ds.surface.surfaceVariant,
    gap: '4@ms',
  },
  failedText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  altText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontStyle: 'italic',
    color: colors.ds.typography.mediumEmphasis,
  },
});
