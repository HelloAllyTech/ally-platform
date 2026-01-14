import {FlatList, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Message as MessageComponent} from '@/components/Message';
import {SelectableTextArea} from '@/components/SelectableTextArea/SelectableTextArea';
import {fontFamily, typography} from '@/theme';
import {colors} from '@/theme/colors';
import {MessageData} from '@/types/reviews';

const formatTimestamp = (startSeconds: number) => {
  const minutes = Math.floor(startSeconds / 60);
  const seconds = Math.floor(startSeconds % 60);
  return `0${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};
export interface ConversationProps {
  messages: MessageData[];
  isSelectable?: boolean;
  onSelection?: (selection: string, messageId: string) => void;
  currentHighlightedText?: string;
  onThreadClick?: (threadId: string, messageId: string) => void;
}

export const Conversation: React.FC<ConversationProps> = ({
  messages,
  isSelectable = true,
  onSelection,
  currentHighlightedText,
  onThreadClick,
}) => {
  const renderEmptyComponent = () => (
    <View style={styles.centered}>
      <Text>No messages found.</Text>
    </View>
  );

  const handleSelection = (selection: string, messageId: string) => {
    onSelection?.(selection, messageId);
  };

  const renderSelectableMessage = (messageItem: MessageData) => (
    <SelectableTextArea
      menuOptions={['Add Comment']}
      onSelection={selection => handleSelection?.(selection, messageItem.id)}>
      <Text>
        <Text style={styles.userName}>{messageItem.senderId}:</Text>{' '}
        <Text style={styles.messageContent}>
          {messageItem.messagePart.map(part => (
            <Text
              onPress={() => {
                if (part.commentIds.length > 0) {
                  onThreadClick?.(part.commentIds[0], messageItem.id);
                }
              }}
              disabled={part.commentIds.length === 0}
              key={part.text}
              style={[part.commentIds.length > 0 && styles.highlightedText]}>
              {part.text}
            </Text>
          ))}
        </Text>
      </Text>
    </SelectableTextArea>
  );

  const renderDefaultMessage = (messageItem: MessageData) => (
    <Text>
      <Text style={styles.userName}>{messageItem.senderId}:</Text>{' '}
      <Text style={styles.messageContent}>
        {messageItem.messagePart.map(part => (
          <Text
            onPress={() => {
              if (part.commentIds.length > 0) {
                onThreadClick?.(part.commentIds[0], messageItem.id);
              }
            }}
            disabled={part.commentIds.length === 0}
            key={part.text}
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
      message={
        isSelectable
          ? renderSelectableMessage(item)
          : renderDefaultMessage(item)
      }
    />
  );

  return (
    <FlatList
      data={messages}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.listContainer}
      renderItem={renderItem}
      ListEmptyComponent={renderEmptyComponent}
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
    color: colors.ds.theme.primary,
  },
  highlightedText: {
    backgroundColor: colors.ds.amber[50],
    borderBottomWidth: '1@ms',
    borderBottomColor: colors.ds.amber[500],
  },
});
