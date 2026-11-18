import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthGuard, Client, CurrentClient } from '../../clients';
import { MessageProcessor } from '../application/message-processor';
import { MessagesService } from '../application/messages.service';
import { MESSAGE_QUEUE } from '../application/ports';
import type { QueueItem } from '../application/ports';
import { SendMessageUseCase } from '../application/send-message.use-case';
import { PriorityMessageQueue } from '../queue/priority-message-queue';
import { ListMessagesQuery, SendMessageDto } from './dto';
import { presentConversation, presentMessage, presentStatus } from './presenters';

@ApiTags('messages')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Client-Document', required: false, description: 'CPF/CNPJ (alternativa ao Bearer token)' })
@UseGuards(AuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly sendMessage: SendMessageUseCase,
    private readonly messages: MessagesService,
  ) {}

  @Post()
  async send(@CurrentClient() client: Client, @Body() dto: SendMessageDto) {
    const result = await this.sendMessage.execute(client, { ...dto, priority: dto.priority ?? 'normal' });
    return {
      id: result.message.id,
      conversationId: result.message.conversationId,
      status: result.message.status,
      estimatedDelivery: result.estimatedDelivery.toISOString(),
      cost: result.message.cost.toDecimal(),
      currentBalance: result.client.planType === 'prepaid' ? result.client.account.balance.toDecimal() : undefined,
    };
  }

  @Get()
  async list(@CurrentClient() client: Client, @Query() query: ListMessagesQuery) {
    return (await this.messages.list(client, query)).map(presentMessage);
  }

  @Get(':id')
  async get(@CurrentClient() client: Client, @Param('id') id: string) {
    return presentMessage(await this.messages.get(client, id));
  }

  @Get(':id/status')
  async status(@CurrentClient() client: Client, @Param('id') id: string) {
    return presentStatus(await this.messages.get(client, id));
  }

  @Patch(':id/read')
  async read(@CurrentClient() client: Client, @Param('id') id: string) {
    return presentStatus(await this.messages.markRead(client, id));
  }
}

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  async list(@CurrentClient() client: Client) {
    return (await this.messages.listConversations(client)).map(presentConversation);
  }

  @Get(':id')
  async get(@CurrentClient() client: Client, @Param('id') id: string) {
    return presentConversation(await this.messages.getConversation(client, id));
  }

  @Get(':id/messages')
  async listMessages(@CurrentClient() client: Client, @Param('id') id: string) {
    return (await this.messages.conversationMessages(client, id)).map(presentMessage);
  }
}

@ApiTags('queue')
@Controller('queue')
export class QueueController {
  constructor(
    @Inject(MESSAGE_QUEUE) private readonly queue: PriorityMessageQueue<QueueItem>,
    private readonly processor: MessageProcessor,
  ) {}

  @Get('status')
  status() {
    const snapshot = this.queue.snapshot();
    const worker = this.processor.stats();
    return {
      size: { urgent: snapshot.urgent, normal: snapshot.normal, total: snapshot.total },
      enqueued: snapshot.enqueued,
      processed: worker.processed,
      failed: worker.failed,
      retried: worker.retried,
      averageWaitMs: worker.averageWaitMs,
      antiStarvation: { urgentBurst: snapshot.urgentBurst, preventions: snapshot.starvationPreventions },
      worker: { mode: worker.mode, running: worker.running },
    };
  }
}
