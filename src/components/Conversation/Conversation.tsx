import {FlatList, StyleSheet, Text, View} from 'react-native';

import {Message as MessageComponent} from '@/components/Message';
import {SelectableTextArea} from '@/components/SelectableTextArea/SelectableTextArea';
import {Message} from '@/services/reviewsApi';
import {fontFamily, typography} from '@/theme';
import {colors} from '@/theme/colors';

const formatTimestamp = (startSeconds: number) => {
  const minutes = Math.floor(startSeconds / 60);
  const seconds = Math.floor(startSeconds % 60);
  return `0${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

export interface ConversationProps {
  messages: Message[];
  isSelectable?: boolean;
  onSelection?: (selection: string, messageId: string) => void;
  currentHighlightedText?: string;
}

export const Conversation: React.FC<ConversationProps> = ({
  messages,
  isSelectable = true,
  onSelection,
  currentHighlightedText,
}) => {
  const renderEmptyComponent = () => (
    <View style={styles.centered}>
      <Text>No messages found.</Text>
    </View>
  );

  const handleSelection = (selection: string, messageId: string) => {
    onSelection?.(selection, messageId);
  };

  const renderSelectableMessage = (messageItem: Message) => (
    <SelectableTextArea
      menuOptions={['Add Comment']}
      onSelection={selection => handleSelection?.(selection, messageItem.id)}>
      <Text>
        <Text style={styles.userName}>{messageItem.senderId}:</Text>{' '}
        <Text style={styles.messageContent}>{messageItem.content}</Text>
      </Text>
    </SelectableTextArea>
  );

  const renderDefaultMessage = (messageItem: Message) => (
    <Text>
      <Text style={styles.userName}>{messageItem.senderId}:</Text>{' '}
      <Text style={styles.messageContent}>{messageItem.content}</Text>
    </Text>
  );

  const renderItem = ({item}: {item: Message}) => (
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

const styles = StyleSheet.create({
  listContainer: {
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageContent: {
    color: 'rgba(0, 0, 0, 0.87)',
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
});
