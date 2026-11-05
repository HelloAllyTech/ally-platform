import {useCallback, useEffect, useRef, useState} from 'react';
import {Modal, Pressable, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon, RetrySessionIcon} from '@/assets';
import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

const AUTO_RETRY_SECONDS = 30;
const COOLDOWN_SECONDS = 30;

interface RetrySessionModalProps {
  visible: boolean;
  onClose: () => void;
  onRetry: () => Promise<boolean>;
}
export const RetrySessionModal = ({
  visible,
  onClose,
  onRetry,
}: RetrySessionModalProps) => {
  const [timeleft, setTimeleft] = useState<number>(AUTO_RETRY_SECONDS);
  const [retryStatus, setRetryStatus] = useState<'autoRetry' | 'cooldown'>(
    'autoRetry',
  );
  const [isRetrying, setIsRetrying] = useState(false);
  const {t} = useTranslate();
  const isRetryingRef = useRef(false);

  const triggerRetry = useCallback(async () => {
    if (isRetryingRef.current) {
      return;
    }
    isRetryingRef.current = true;
    setIsRetrying(true);

    try {
      const success = await onRetry();
      if (!success) {
        setRetryStatus('cooldown');
        setTimeleft(COOLDOWN_SECONDS);
      }
    } finally {
      isRetryingRef.current = false;
      setIsRetrying(false);
    }
  }, [onRetry]);

  const handleRetry = useCallback(() => {
    triggerRetry();
  }, [triggerRetry]);

  useEffect(() => {
    if (!visible) {
      setTimeleft(AUTO_RETRY_SECONDS);
      setRetryStatus('autoRetry');
      setIsRetrying(false);
      isRetryingRef.current = false;
      return;
    }

    const interval = setInterval(() => {
      if (isRetryingRef.current) {
        return;
      }

      setTimeleft(prev => {
        if (prev <= 1) {
          if (retryStatus !== 'autoRetry') {
            setRetryStatus('autoRetry');
            return AUTO_RETRY_SECONDS;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [retryStatus, visible]);

  useEffect(() => {
    if (
      timeleft === 0 &&
      retryStatus === 'autoRetry' &&
      !isRetryingRef.current
    ) {
      triggerRetry();
    }
  }, [timeleft, retryStatus, triggerRetry]);

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.container}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <CloseIcon />
          </TouchableOpacity>
          <Text style={styles.title}>{t('common.maxActiveUsers.title')}</Text>
          <RetrySessionIcon />
          <Text style={styles.description}>
            {t('common.maxActiveUsers.description')}
          </Text>
          <Button
            label={t('common.retry')}
            onPress={handleRetry}
            customContainerStyle={styles.button}
            isDisabled={retryStatus === 'cooldown' || isRetrying}
            isLoading={isRetrying}
          />
          <Text style={styles.autoRetryDescription}>
            {retryStatus === 'cooldown'
              ? t('common.maxActiveUsers.manualRetry')
              : t('common.maxActiveUsers.autoRetry')}{' '}
            {timeleft}
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    backgroundColor: colors.blackTransparent50,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '12@s',
    padding: '16@s',
    width: '80%',
  },
  closeBtn: {
    position: 'absolute',
    right: '7@ms',
    top: '5@ms',
    padding: '6@ms',
    zIndex: 1,
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.body.large,
    color: colors.darkGray12,
    fontWeight: fontWeights.medium,
    textAlign: 'center',
  },
  subtitle: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    ...typography.body.large,
    color: colors.darkGray2,
    fontWeight: fontWeights.medium,
    textAlign: 'center',
    marginBottom: '10@ms',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.darkGray2,
    fontWeight: fontWeights.regular,
    textAlign: 'center',
    marginVertical: '10@ms',
  },
  button: {
    width: 'auto',
    paddingHorizontal: '20@ms',
  },
  autoRetryDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.tiny,
    color: colors.darkGray16,
    fontWeight: fontWeights.regular,
    textAlign: 'center',
    marginVertical: '10@ms',
  },
});
