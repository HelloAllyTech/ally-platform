import { DataSource } from 'typeorm';
import { Chatbot } from 'src/chatbot/entity/chatbot.entity';
import { ChatbotContactIdentity } from 'src/chatbot/entity/chatbot-contact-identity.entity';
import { ChatbotContact } from 'src/chatbot/entity/chatbot-contact.entity';
import { ChatbotConversation } from 'src/chatbot/entity/chatbot-conversation.entity';
import { ChatbotMessage } from 'src/chatbot/entity/chatbot-message.entity';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../entity/wa-unanswered-question.entity';

/** Every entity the shared-store backfill and check read or write. */
export const SHARED_STORE_ENTITIES = [
  Chatbot,
  ChatbotContact,
  ChatbotContactIdentity,
  ChatbotConversation,
  ChatbotMessage,
  WaContact,
  WaConversation,
  WaMessage,
  WaUnansweredQuestion,
];

/** A connection for the backfill and check scripts, from the same DB_* variables as the app. */
export function sharedStoreDataSource(): DataSource {
  const database = process.env.DB_DATABASE;
  if (!database) {
    throw new Error('DB_DATABASE is not defined. Did you load your .env file?');
  }
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database,
    entities: SHARED_STORE_ENTITIES,
    synchronize: false,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    logging: false,
  });
}
