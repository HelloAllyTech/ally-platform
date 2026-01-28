import {ActivityIndicator, FlatList, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Message as MessageComponent} from '@/components/Message';
import {SelectableTextArea} from '@/components/SelectableTextArea/SelectableTextArea';
import {SelectableTextInput} from '@/components/SelectableTextInput/SelectableTextInput';
import {useTranslate} from '@/hooks';
import {useAppSelector} from '@/store/hooks';
import {fontFamily, typography} from '@/theme';
import {colors} from '@/theme/colors';
import {MessageData, TextSelection} from '@/types/reviews';

const formatTimestamp = (startSeconds: number) => {
  const minutes = Math.floor(startSeconds / 60);
  const seconds = Math.floor(startSeconds % 60);
  return `0${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};
export interface ConversationProps {
  messages: MessageData[];
  isSelectable?: boolean;
  onSelection?: (selection: TextSelection, messageId: string) => void;
  onThreadClick?: (threadId: string, messageId: string) => void;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const Conversation: React.FC<ConversationProps> = ({
  messages,
  isSelectable = true,
  onSelection,
  onThreadClick,
  onLoadMore,
  isLoadingMore = false,
  hasMore = false,
  onRefresh,
  isRefreshing = false,
}) => {
  const {t} = useTranslate();
  const userName = useAppSelector(state => state.user.user?.name);
  const renderEmptyComponent = () => (
    <View style={styles.centered}>
      <Text>No messages found.</Text>
    </View>
  );

  const handleSelection = (selection: TextSelection, messageId: string) => {
    onSelection?.(selection, messageId);
  };

  const renderSelectableMessageV2 = (messageItem: MessageData) => {
    const highlightedPartIndices = messageItem.messagePart
      .map((part, index) => (part.commentIds.length > 0 ? index : -1))
      .filter(index => index !== -1);
    const isAiClient = messageItem.senderId === -1;
    return (
      <SelectableTextInput
        prefixText={
          isAiClient ? 'AI Client' : userName || t('CallTranscript.you')
        }
        prefixTextStyle={isAiClient ? styles.clientAgentText : styles.userName}
        parts={messageItem.messagePart.map(part => part.text)}
        highlightedPartIndices={highlightedPartIndices}
        highlightStyle={styles.highlightedText}
        partTextStyle={styles.messageContent}
        separator=""
        key={`${messageItem.id}`}
        onAddComment={selectionData =>
          handleSelection(selectionData, messageItem.id)
        }
        multiline
      />
    );
  };

  const renderSelectableMessage = (messageItem: MessageData) => (
    <SelectableTextArea
      menuOptions={['Add Comment']}
      onSelection={selection => handleSelection(selection, messageItem.id)}>
      <Text style={styles.messageContent}>
        {messageItem.messagePart.map((part, index) => (
          <Text
            disabled={part.commentIds.length === 0}
            key={`${messageItem.id}-${index}`}
            style={[part.commentIds.length > 0 && styles.highlightedText]}>
            {part.text}
          </Text>
        ))}
      </Text>
    </SelectableTextArea>
  );

  const renderDefaultMessage = (messageItem: MessageData) => (
    <Text>
      <Text style={styles.userName}>{messageItem.senderId}:</Text>{' '}
      <Text style={styles.messageContent}>
        {messageItem.messagePart.map((part, index) => (
          <Text
            disabled={part.commentIds.length === 0}
            key={`${messageItem.id}-${index}`}
            style={[part.commentIds.length > 0 && styles.highlightedText]}>
            {part.text}
          </Text>
        ))}
      </Text>
    </Text>
  );

  const renderItem = ({item}: {item: MessageData}) => (
    <MessageComponent
      timestamp={formatTimestamp(item.startSeconds)}
      onPress={() => onThreadClick?.(item.id, item.id)}
      message={
        isSelectable
          ? renderSelectableMessageV2(item)
          : renderDefaultMessage(item)
      }
    />
  );

  const renderFooter = () => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.ds.theme.primary} />
      </View>
    );
  };

  return (
    <FlatList
      data={messages}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.listContainer}
      renderItem={renderItem}
      ListEmptyComponent={renderEmptyComponent}
      ListFooterComponent={renderFooter}
      onEndReached={hasMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.5}
      refreshing={isRefreshing}
      onRefresh={onRefresh}
    />
  );
};

const styles = ScaledSheet.create({
  listContainer: {
    padding: '16@ms',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageContent: {
    color: colors.ds.blackAlpha[900],
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
  },
  userName: {
    color: colors.ds.theme.primary,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
  },
  clientAgentText: {
    color: colors.black,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
  },
  highlightedText: {
    backgroundColor: colors.ds.amber[50],
    borderBottomWidth: '1@ms',
    borderBottomColor: colors.ds.amber[500],
  },
  footerLoader: {
    paddingVertical: '16@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
