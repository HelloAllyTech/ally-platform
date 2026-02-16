import React, {useCallback, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  AndroidCommentMessageRow,
  SelectionChangeEvent,
  SingleTapEvent,
} from '@/components/AndroidCommentMessageRow';
import {
  CommentableTextInput,
  type AddCommentMenuData,
  type SelectionData,
} from '@/components/CommentableTextInput/CommentableTextInput';
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
const isIOS = Platform.OS === 'ios';

// iOS floating "Add comment" menu dimensions
const IOS_MENU_W = 140;
const IOS_MENU_H = 44;

type FloatingMenuData = {
  position: {x: number; y: number};
  messageId: string;
  selectionData: SelectionData;
};

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
  /** Called when the user taps outside selectable text (e.g. timestamp, empty space) or scrolls */
  onDismissSelection?: () => void;
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
  onDismissSelection,
}) => {
  const {t} = useTranslate();

  // only one active menu across list
  const [activeMenuMessageId, setActiveMenuMessageId] = useState<string | null>(
    null,
  );
  // bump to force-close currently-open menu
  const [closeSignal, setCloseSignal] = useState(0);

  // ── iOS floating "Add comment" menu ─────────────────────────
  const [floatingMenu, setFloatingMenu] = useState<FloatingMenuData | null>(
    null,
  );
  const conversationRef = useRef<View>(null);
  const conversationOffsetRef = useRef({x: 0, y: 0});

  const measureConversationOffset = useCallback(() => {
    conversationRef.current?.measureInWindow((x, y) => {
      conversationOffsetRef.current = {x, y};
    });
  }, []);

  const dismissAnyMenu = useCallback(() => {
    setActiveMenuMessageId(null);
    setCloseSignal(s => s + 1);
    setFloatingMenu(null);
  }, []);

  // Bump to tell ALL native AndroidCommentMessageRow views to clear their
  // text selection (which also dismisses the native ActionMode toolbar).
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0);

  const dismissNativeSelection = useCallback(() => {
    setClearSelectionSignal(s => s + 1);
    onDismissSelection?.();
  }, [onDismissSelection]);

  // Timer used to debounce "dismiss on touch" — cancelled if a selection
  // event fires shortly after (meaning the user touched text, not empty space).
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── iOS floating menu callbacks ──────────────────────────────
  const handleShowAddCommentMenu = useCallback((data: AddCommentMenuData) => {
    // Cancel any pending dismiss — the user is interacting with text.
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    // Re-measure offset for accurate positioning
    conversationRef.current?.measureInWindow((x, y) => {
      conversationOffsetRef.current = {x, y};
      setFloatingMenu(data);
    });
  }, []);

  const handleHideAddCommentMenu = useCallback((msgId: string) => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setFloatingMenu(prev => (prev && prev.messageId === msgId ? null : prev));
  }, []);

  const handleFloatingMenuAddComment = useCallback(() => {
    if (!floatingMenu) return;
    onSelection?.(
      {
        startIndex: floatingMenu.selectionData.startIndex,
        endIndex: floatingMenu.selectionData.endIndex,
        selectedText: floatingMenu.selectionData.selectedText,
      },
      floatingMenu.messageId,
    );
    dismissAnyMenu();
  }, [floatingMenu, onSelection, dismissAnyMenu]);

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

  // ── Android single-tap → thread handler ────────────────────────
  // Maps the character offset from native to the correct message part,
  // and if that part has threads, opens the threads bottom sheet.
  const handleAndroidSingleTap = useCallback(
    (event: SingleTapEvent) => {
      const msg = messages.find(m => String(m.id) === event.messageId);
      if (!msg) return;

      let charCount = 0;
      for (const part of msg.messagePart) {
        const partEnd = charCount + part.text.length;
        if (event.offset >= charCount && event.offset < partEnd) {
          if (part.commentIds.length > 0) {
            onThreadClick?.(part.commentIds, event.messageId);
          }
          return;
        }
        charCount = partEnd;
      }
    },
    [messages, onThreadClick],
  );

  const getSenderName = useCallback(
    (isAiClient: boolean) =>
      isAiClient ? 'AI Client' : (reviewOwnerName ?? t('CallTranscript.you')),
    [reviewOwnerName, t],
  );

  // ── iOS selection component ─────────────────────────────────
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
        onShowAddCommentMenu={handleShowAddCommentMenu}
        onHideAddCommentMenu={handleHideAddCommentMenu}
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
    // Layout is built manually (not using MessageComponent) so that only
    // the timestamp and sender name are wrapped in Pressable for dismiss.
    // Wrapping the *entire* row in Pressable steals touches from the
    // native selection view and breaks text selection.
    if (isAndroid && isSelectable) {
      return (
        <View style={styles.androidRow}>
          <Pressable
            onPress={dismissNativeSelection}
            style={styles.androidTimestampColumn}>
            <Text style={styles.androidTimestamp} numberOfLines={1}>
              {formatTimestamp(item.startSeconds)}
            </Text>
          </Pressable>
          <View style={styles.androidMessageColumn}>
            <AndroidCommentMessageRow
              messageId={String(item.id)}
              onSelectionChange={handleAndroidSelectionChange}
              onSingleTap={handleAndroidSingleTap}
              clearSelectionSignal={clearSelectionSignal}
              prefixLength={`${getSenderName(isAiClient)}: `.length}
              style={styles.selectableWrapper}>
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
                      style={hasThread ? styles.highlightedText : undefined}>
                      {part.text}
                    </Text>
                  );
                })}
              </Text>
            </AndroidCommentMessageRow>
          </View>
        </View>
      );
    }

    // ── iOS selectable or non-selectable ───────────────
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
    <View
      ref={conversationRef}
      style={styles.flex1}
      onLayout={measureConversationOffset}>
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
        onScrollBeginDrag={() => {
          dismissAnyMenu();
          dismissNativeSelection();
        }}
        onTouchStart={() => {
          // When the floating menu is visible, schedule a dismiss.
          // If a selection-change event fires within 150ms (meaning the
          // touch landed on text / selection handles), the timer is
          // cancelled in handleShowAddCommentMenu so the menu stays.
          if (floatingMenu) {
            if (dismissTimerRef.current) {
              clearTimeout(dismissTimerRef.current);
            }
            dismissTimerRef.current = setTimeout(() => {
              dismissTimerRef.current = null;
              dismissAnyMenu();
            }, 150);
          }
        }}
        keyboardShouldPersistTaps="handled"
      />

      {/* iOS floating "Add comment" menu — rendered OUTSIDE the FlatList
          so it doesn't interfere with native selection handles. */}
      {isIOS && floatingMenu && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View
            style={[
              styles.iosMenuContainer,
              {
                top: floatingMenu.position.y - conversationOffsetRef.current.y,
                left: floatingMenu.position.x - conversationOffsetRef.current.x,
                width: IOS_MENU_W,
                height: IOS_MENU_H,
              },
            ]}>
            <TouchableOpacity
              style={styles.iosMenuItem}
              onPress={handleFloatingMenuAddComment}
              activeOpacity={0.7}>
              <Text style={styles.iosMenuItemText}>Add comment</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  flex1: {
    flex: 1,
  },
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
  androidRow: {
    flexDirection: 'row',
    paddingHorizontal: '16@ms',
    paddingVertical: '6@mvs',
    gap: '16@ms',
  },
  androidTimestampColumn: {
    flexShrink: 0,
    alignSelf: 'stretch',
  },
  androidTimestamp: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: 'rgba(0, 0, 0, 0.6)',
  },
  androidMessageColumn: {
    flex: 1,
  },
  selectableWrapper: {
    flex: 1,
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
  // ── iOS floating "Add comment" menu ──
  iosMenuContainer: {
    position: 'absolute',
    backgroundColor: colors.ds.surface.background,
    borderRadius: 8,
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 20,
    zIndex: 9999,
  },
  iosMenuItem: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  iosMenuItemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});
