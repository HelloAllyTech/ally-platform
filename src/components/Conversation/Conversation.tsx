import React, {useCallback, useState} from 'react';
import {ActivityIndicator, FlatList, Platform, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  AndroidCommentMessageRow,
  SelectionChangeEvent,
} from '@/components/AndroidCommentMessageRow';
import {CommentableTextInput} from '@/components/CommentableTextInput/CommentableTextInput';
import {Message as MessageComponent} from '@/components/Message';
import {useTranslate} from '@/hooks';
import {fontFamily, typography} from '@/theme';
import {colors} from '@/theme/colors';
import {MessageData, TextSelection} from '@/types/reviews';

const formatTimestamp = (startSeconds: number) => {
  const minutes = Math.floor(startSeconds / 60);
  const seconds = Math.floor(startSeconds % 60);
  return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

const isAndroid = Platform.OS === 'android';

export interface ConversationProps {
  messages: MessageData[];
  isSelectable?: boolean;
  onSelection?: (selection: TextSelection, messageId: string) => void;
  onThreadClick?: (commentIds: string[], messageId: string) => void;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  reviewOwnerName?: string;
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
  reviewOwnerName,
}) => {
  const {t} = useTranslate();

  // only one active menu across list
  const [activeMenuMessageId, setActiveMenuMessageId] = useState<string | null>(
    null,
  );
  // bump to force-close currently-open menu
  const [closeSignal, setCloseSignal] = useState(0);

  const dismissAnyMenu = useCallback(() => {
    setActiveMenuMessageId(null);
    setCloseSignal(s => s + 1);
  }, []);

  const renderEmptyComponent = () => (
    <View style={styles.centered}>
      <Text>No messages found.</Text>
    </View>
  );

  const handleSelection = (selection: TextSelection, messageId: string) => {
    onSelection?.(selection, messageId);
  };

  // ── Android native row handler ──────────────────────────────────
  const handleAndroidSelectionChange = useCallback(
    (event: SelectionChangeEvent) => {
      onSelection?.(
        {
          startIndex: event.start,
          endIndex: event.end,
          selectedText: event.selectedText,
        },
        event.messageId,
      );
    },
    [onSelection],
  );

  const getSenderName = useCallback(
    (isAiClient: boolean) =>
      isAiClient ? 'AI Client' : (reviewOwnerName ?? t('CallTranscript.you')),
    [reviewOwnerName, t],
  );

  // ── iOS component (unchanged) ─────────────────────────────────
  const selectionTextIOSComponent = (
    messageItem: MessageData,
    isAiClient: boolean,
    highlightedPartIndices: number[],
  ) => {
    return (
      <CommentableTextInput
        messageId={messageItem.id}
        isActive={activeMenuMessageId === messageItem.id}
        requestCloseSignal={closeSignal}
        onRequestActivate={id => {
          // close any previously open menu and activate this one
          setActiveMenuMessageId(id);
        }}
        onRequestClose={dismissAnyMenu}
        prefixText={`${getSenderName(isAiClient)}:`}
        prefixTextStyle={isAiClient ? styles.clientAgentText : styles.userName}
        parts={messageItem.messagePart}
        highlightedPartIndices={highlightedPartIndices}
        highlightStyle={styles.highlightedText}
        partTextStyle={styles.messageContent}
        separator=""
        key={`${messageItem.id}`}
        onAddComment={selectionData =>
          handleSelection(selectionData, messageItem.id)
        }
        onCommentIdsPress={commentIds =>
          onThreadClick?.(commentIds, messageItem.id)
        }
        multiline
      />
    );
  };

  // ── Selectable message renderer (iOS only now) ────────────────
  const renderSelectableMessageIOS = (messageItem: MessageData) => {
    const highlightedPartIndices = messageItem.messagePart
      .map((part, index) => (part.commentIds.length > 0 ? index : -1))
      .filter(index => index !== -1);

    const isAiClient = messageItem.senderId === -1;

    return selectionTextIOSComponent(
      messageItem,
      isAiClient,
      highlightedPartIndices,
    );
  };

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

  const renderItem = ({item}: {item: MessageData}) => {
    const isAiClient = item.senderId === -1;

    // ── Android + selectable → native selection wrapper around RN <Text> ──
    if (isAndroid && isSelectable) {
      return (
        <MessageComponent
          timestamp={formatTimestamp(item.startSeconds)}
          message={
            <AndroidCommentMessageRow
              messageId={String(item.id)}
              onSelectionChange={handleAndroidSelectionChange}
              style={{flex: 1}}>
              <Text style={styles.messageContent}>
                <Text
                  style={isAiClient ? styles.clientAgentText : styles.userName}>
                  {getSenderName(isAiClient)}:{' '}
                </Text>
                {item.messagePart.map((part, index) => {
                  const hasThread = part.commentIds.length > 0;
                  return (
                    <Text
                      key={`${item.id}-${index}`}
                      style={hasThread ? styles.highlightedText : undefined}
                      onPress={
                        hasThread
                          ? () =>
                              onThreadClick?.(part.commentIds, String(item.id))
                          : undefined
                      }>
                      {part.text}
                    </Text>
                  );
                })}
              </Text>
            </AndroidCommentMessageRow>
          }
        />
      );
    }

    // ── iOS selectable or non-selectable fallback ───────────────
    return (
      <MessageComponent
        timestamp={formatTimestamp(item.startSeconds)}
        onPress={isSelectable ? undefined : () => onThreadClick?.([], item.id)}
        message={
          isSelectable
            ? renderSelectableMessageIOS(item)
            : renderDefaultMessage(item)
        }
      />
    );
  };

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
      onScrollBeginDrag={dismissAnyMenu}
      keyboardShouldPersistTaps="handled"
    />
  );
};

const styles = ScaledSheet.create({
  listContainer: {
    padding: '16@ms',
    paddingBottom: '100@ms',
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
