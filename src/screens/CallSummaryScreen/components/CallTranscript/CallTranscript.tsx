import {useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyTranscriptIcon} from '@/assets/icons';
import {useCallTranscriptDetails} from '@/hooks/useCallTranscriptDetails';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

type Message = {
  id: number;
  message: string;
  time: string;
  counselor: boolean;
  client: boolean;
};

export const CallTranscript = ({chatId}: {chatId: number}) => {
  const {formattedMessages, isLoading, listRef, handleEndReached} =
    useCallTranscriptDetails(chatId);

  const [isContentShort, setIsContentShort] = useState(false);
  const {height: screenHeight} = useWindowDimensions();

  const {t} = useTranslate();

  const renderItem = ({item}: {item: Message}) => {
    const {time, counselor, message} = item;
    return (
      <View style={styles.messageContainer}>
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{time}</Text>
        </View>
        <View style={styles.messageContent}>
          <Text style={styles.messageText}>
            {`${counselor ? t('CallTranscript.you') : t('CallTranscript.client')}: `}
            <Text style={styles.message}>{message}</Text>
          </Text>
        </View>
      </View>
    );
  };

  const renderEmptyComponent = () => {
    return (
      <View style={styles.emptyContainer}>
        <EmptyTranscriptIcon />
        <Text style={styles.emptyText}>{t('CallTranscript.empty')}</Text>
      </View>
    );
  };
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        isContentShort && styles.reducedTopPadding,
      ]}
      ref={listRef}
      data={formattedMessages as Message[]}
      keyExtractor={item => item.id.toString()}
      renderItem={renderItem}
      ListFooterComponent={isLoading ? <ActivityIndicator /> : null}
      onContentSizeChange={(w, h) => {
        setIsContentShort(h < screenHeight);
      }}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.1}
      ListEmptyComponent={renderEmptyComponent}
    />
  );
};

const styles = ScaledSheet.create({
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: '40%',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    fontSize: '16@ms',
    lineHeight: '24@mvs',
    marginTop: '30@mvs',
    marginHorizontal: '30%',
    textAlign: 'center',
  },
  container: {
    flex: 1,
    paddingHorizontal: '32@ms',
  },
  messageContainer: {
    marginVertical: '7@mvs',
    flexDirection: 'row',
  },
  timeContainer: {
    width: '60@ms',
  },
  timeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.mediumGray2,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
  },
  messageText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.black,
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.charcoal2,
  },
  messageContent: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: '90@mvs',
    paddingBottom: '48@mvs',
  },
  reducedTopPadding: {
    paddingTop: '0@mvs',
  },
});
