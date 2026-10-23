import {ActivityIndicator, FlatList} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyTranscript} from '@/components';
import {useCallTranscriptDetails, useTranslate} from '@/hooks';
import {SummaryCard} from '@/screens/SimulationFeedbackScreen/components/SummaryCard';
import {CallTranscriptMessage} from '@/types';

import {CallTranscriptItem} from '../CallTranscriptItem';

export const CallTranscript = ({chatId}: {chatId: number}) => {
  const {formattedMessages, isLoading, listRef, handleEndReached, summaryData} =
    useCallTranscriptDetails(chatId);

  const {t} = useTranslate();
  const isDictationMode = summaryData?.details?.callInfo?.mode === 'DICTATION';

  const renderItem = ({item}: {item: CallTranscriptMessage}) => {
    const {time, counselor, message} = item;
    return (
      <CallTranscriptItem
        time={time}
        message={message}
        counselor={counselor}
        speakerLabel={
          counselor
            ? t('transcription.youLabel')
            : t('transcription.clientLabel')
        }
      />
    );
  };

  const renderEmptyComponent = () => <EmptyTranscript />;
  return (
    <SummaryCard title={t('callSummary.header.transcript')}>
      {isDictationMode ? (
        <CallTranscriptItem
          time=""
          message={formattedMessages.map(m => m.message).join(' ')}
          speakerLabel=""
          isDictation
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.contentContainer}
          ref={listRef}
          data={formattedMessages}
          testID="transcript-list"
          keyExtractor={item => item.id.toString()}
          renderItem={renderItem}
          ListFooterComponent={isLoading ? <ActivityIndicator /> : null}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.1}
          ListEmptyComponent={renderEmptyComponent}
        />
      )}
    </SummaryCard>
  );
};

const styles = ScaledSheet.create({
  contentContainer: {
    paddingBottom: '48@mvs',
  },
});
