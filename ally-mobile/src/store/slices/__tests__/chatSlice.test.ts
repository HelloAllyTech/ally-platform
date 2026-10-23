import reducer, {
  clearCurrentChat,
  setCurrentChat,
  setCurrentChatId,
} from '@/store/slices/chatSlice';
import {AllyPlatforms} from '@/constants';
import {Chat, ChatProvider, ChatStatus, MessageType, User, UserRole} from '@/types';

const mockUser = (id: number): User => ({
  email: `user${id}@example.com`,
  id,
  name: `User ${id}`,
  phone: '1234567890',
  role: UserRole.CLIENT,
  userId: id,
});

const mockChat: Chat = {
  chatId: 10,
  client: mockUser(1),
  clientId: 1,
  counselor: mockUser(2),
  counselorId: 2,
  endedAt: null,
  messages: [
    {
      chatId: 10,
      content: 'hello',
      createdAt: new Date().toISOString(),
      id: 1,
      senderId: 1,
      type: MessageType.TEXT,
    },
  ],
  startedAt: new Date().toISOString(),
  status: ChatStatus.ACTIVE,
  provider: ChatProvider.MICROPHONE,
  platform: AllyPlatforms.MOBILE,
};

describe('chatSlice reducers', () => {
  it('should return initial state', () => {
    const state = reducer(undefined, {type: 'unknown'} as any);
    expect(state.currentChat).toBeNull();
  });

  it('setCurrentChat should set current chat', () => {
    const next = reducer(undefined, setCurrentChat(mockChat));
    expect(next.currentChat).toEqual(mockChat);
  });

  it('clearCurrentChat should reset current chat', () => {
    const withChat = reducer(undefined, setCurrentChat(mockChat));
    const cleared = reducer(withChat, clearCurrentChat());
    expect(cleared.currentChat).toBeNull();
  });
});

describe('chatSlice setCurrentChatId', () => {
  it('records a chat id when nothing is stored yet', () => {
    const state = reducer(undefined, setCurrentChatId(2580));
    expect(state.currentChat?.chatId).toBe(2580);
  });

  it('leaves the rest of an existing chat alone', () => {
    const withChat = reducer(undefined, setCurrentChat(mockChat));
    const next = reducer(withChat, setCurrentChatId(2580));
    expect(next.currentChat?.chatId).toBe(2580);
    expect(next.currentChat?.startedAt).toBe(mockChat.startedAt);
    expect(next.currentChat?.messages).toEqual(mockChat.messages);
  });

  it('lets the full chat hydrate an id-only start', () => {
    // The order production produces: USER_JOINED carries the id the instant the
    // server creates the chat, and GET /chats/counsellor-chat fills in the rest
    // afterwards. The screen only needs the id to stop saying "Connecting…".
    let state = reducer(undefined, setCurrentChatId(mockChat.chatId));
    expect(state.currentChat?.startedAt).toBeUndefined();

    state = reducer(state, setCurrentChat(mockChat));
    expect(state.currentChat).toEqual(mockChat);
  });

  it('is still cleared by clearCurrentChat', () => {
    const withId = reducer(undefined, setCurrentChatId(2580));
    expect(reducer(withId, clearCurrentChat()).currentChat).toBeNull();
  });
});
