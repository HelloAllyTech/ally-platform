import {ActivityIndicator, FlatList} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyTranscript} from '@/components';
import {useCallTranscriptDetails, useTranslate} from '@/hooks';
import {CallTranscriptMessage} from '@/types';

import {CallTranscriptItem} from '../CallTranscriptItem';

export const CallTranscript = ({chatId}: {chatId: number}) => {
  const {formattedMessages, isLoading, listRef, handleEndReached} =
    useCallTranscriptDetails(chatId);

  const {t} = useTranslate();

  const renderItem = ({item}: {item: CallTranscriptMessage}) => {
    const {time, counselor, message} = item;
    return (
      <CallTranscriptItem
        time={time}
        message={message}
        counselor={counselor}
        speakerLabel={
          counselor ? t('CallTranscript.you') : t('CallTranscript.client')
        }
      />
    );
  };

  const renderEmptyComponent = () => <EmptyTranscript />;
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      ref={listRef}
      data={formattedMessages}
      keyExtractor={item => item.id.toString()}
      renderItem={renderItem}
      ListFooterComponent={isLoading ? <ActivityIndicator /> : null}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.1}
      ListEmptyComponent={renderEmptyComponent}
    />
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: '32@ms',
  },
  contentContainer: {
    paddingBottom: '48@mvs',
  },
});
