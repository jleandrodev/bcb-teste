import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients';
import { Database } from '../shared/infra/postgres/database';
import { MessageProcessor } from './application/message-processor';
import { MessagesService } from './application/messages.service';
import {
  CONVERSATION_REPOSITORY,
  MESSAGE_GATEWAY,
  MESSAGE_QUEUE,
  MESSAGE_REPOSITORY,
  QUEUE_OPTIONS,
  queueOptionsFromEnv,
} from './application/ports';
import type { QueueItem, QueueOptions } from './application/ports';
import { SendMessageUseCase } from './application/send-message.use-case';
import { ConversationsController, MessagesController, QueueController } from './http/messaging.controller';
import { InMemoryConversationRepository, InMemoryMessageRepository } from './infra/memory/repositories';
import { PostgresConversationRepository, PostgresMessageRepository } from './infra/postgres/repositories';
import { SimulatedMessageGateway } from './infra/simulated-message-gateway';
import { PriorityMessageQueue } from './queue/priority-message-queue';

/** Composição do módulo de mensagens. Depende de `clients` só pela API pública dele. */
@Module({
  imports: [ClientsModule],
  controllers: [MessagesController, ConversationsController, QueueController],
  providers: [
    SendMessageUseCase,
    MessagesService,
    MessageProcessor,
    { provide: QUEUE_OPTIONS, useFactory: () => queueOptionsFromEnv() },
    {
      provide: MESSAGE_QUEUE,
      inject: [QUEUE_OPTIONS],
      useFactory: (options: QueueOptions) => new PriorityMessageQueue<QueueItem>({ urgentBurst: options.urgentBurst }),
    },
    {
      provide: MESSAGE_GATEWAY,
      inject: [QUEUE_OPTIONS],
      useFactory: (options: QueueOptions) => new SimulatedMessageGateway(options.processingDelayMs),
    },
    {
      provide: MESSAGE_REPOSITORY,
      inject: [Database],
      useFactory: (db: Database) => (db.enabled ? new PostgresMessageRepository(db) : new InMemoryMessageRepository()),
    },
    {
      provide: CONVERSATION_REPOSITORY,
      inject: [Database],
      useFactory: (db: Database) => (db.enabled ? new PostgresConversationRepository(db) : new InMemoryConversationRepository()),
    },
  ],
})
export class MessagingModule {}
