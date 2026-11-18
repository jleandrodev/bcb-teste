import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards, applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard, Client, CurrentClient } from '../../clients';
import { MessageProcessor } from '../application/message-processor';
import { MessagesService } from '../application/messages.service';
import { MESSAGE_QUEUE } from '../application/ports';
import type { QueueItem } from '../application/ports';
import { SendMessageUseCase } from '../application/send-message.use-case';
import { PriorityMessageQueue } from '../queue/priority-message-queue';
import { ListMessagesQuery, SendMessageDto } from './dto';
import { ApiErrors } from '../../shared/http/api-errors';
import { presentConversation, presentMessage, presentStatus } from './presenters';
import { ConversationResponse, MessageResponse, MessageStatusResponse, QueueStatusResponse, SendMessageResponse } from './responses';

/** Rotas do cliente autenticado: exigem Bearer token (de POST /auth) ou o documento no cabeçalho. */
const Authenticated = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiHeader({ name: 'X-Client-Document', required: false, description: 'CPF/CNPJ do cliente (alternativa ao Bearer token)' }),
    UseGuards(AuthGuard),
    ApiErrors(401),
  );

@ApiTags('messages')
@Authenticated()
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly sendMessage: SendMessageUseCase,
    private readonly messages: MessagesService,
  ) {}

  @ApiCreatedResponse({ type: SendMessageResponse })
  @ApiErrors(400, 402, 403, 404)
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

  @ApiOkResponse({ type: [MessageResponse] })
  @ApiErrors(400)
  @Get()
  async list(@CurrentClient() client: Client, @Query() query: ListMessagesQuery) {
    return (await this.messages.list(client, query)).map(presentMessage);
  }

  @ApiOkResponse({ type: MessageResponse })
  @ApiErrors(404)
  @Get(':id')
  async get(@CurrentClient() client: Client, @Param('id') id: string) {
    return presentMessage(await this.messages.get(client, id));
  }

  @ApiOkResponse({ type: MessageStatusResponse })
  @ApiErrors(404)
  @Get(':id/status')
  async status(@CurrentClient() client: Client, @Param('id') id: string) {
    return presentStatus(await this.messages.get(client, id));
  }

  @ApiOkResponse({ type: MessageStatusResponse })
  @ApiErrors(404, 409)
  @Patch(':id/read')
  async read(@CurrentClient() client: Client, @Param('id') id: string) {
    return presentStatus(await this.messages.markRead(client, id));
  }
}

@ApiTags('conversations')
@Authenticated()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly messages: MessagesService) {}

  @ApiOkResponse({ type: [ConversationResponse] })
  @Get()
  async list(@CurrentClient() client: Client) {
    return (await this.messages.listConversations(client)).map(presentConversation);
  }

  @ApiOkResponse({ type: ConversationResponse })
  @ApiErrors(404)
  @Get(':id')
  async get(@CurrentClient() client: Client, @Param('id') id: string) {
    return presentConversation(await this.messages.getConversation(client, id));
  }

  @ApiOkResponse({ type: [MessageResponse] })
  @ApiErrors(404)
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

  @ApiOkResponse({ type: QueueStatusResponse })
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
