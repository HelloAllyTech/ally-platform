import React from 'react';
import {ActivityIndicator, FlatList} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyTranscript} from '@/components/EmptyTranscript/EmptyTranscript';
import {TranscriptItem} from '@/components/TranscriptItem/TranscriptItem';
import {useSimulationTranscriptDetails} from '@/hooks/useSimulationTranscriptDetails';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily} from '@/theme';

type TranscriptItem = {
  id: number;
  time: string;
  message: string;
  counselor: boolean;
};

export const SimulationTranscript: React.FC<{
  sessionId: string;
  startedAt?: string;
}> = ({sessionId, startedAt}) => {
  const {t} = useTranslate();
  const {formattedMessages, isLoading, listRef, handleEndReached} =
    useSimulationTranscriptDetails(sessionId, startedAt);

  const renderItem = ({item}: {item: TranscriptItem}) => {
    const {time, message, counselor} = item;
    return (
      <TranscriptItem
        time={time}
        message={message}
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
      data={formattedMessages as TranscriptItem[]}
      keyExtractor={item => String(item.id)}
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
    paddingHorizontal: '25@ms',
    paddingBottom: '40@vs',
  },
  placeholder: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    fontSize: '15@ms',
  },
  contentContainer: {
    paddingBottom: '48@mvs',
  },
});
