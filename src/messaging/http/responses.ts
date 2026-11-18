import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PRIORITIES = ['normal', 'urgent'];
const STATUSES = ['queued', 'processing', 'sent', 'delivered', 'read', 'failed'];

/** Formato das respostas no OpenAPI. Os presenters montam os objetos; estas classes só os descrevem. */
export class SendMessageResponse {
  @ApiProperty() id!: string;
  @ApiProperty() conversationId!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty({ description: 'Estimativa aproximada, pela posição na fila' }) estimatedDelivery!: string;
  @ApiProperty({ example: 0.25 }) cost!: number;
  @ApiPropertyOptional({ description: 'Saldo após o débito (só pré-pago)' }) currentBalance?: number;
}

export class MessageResponse {
  @ApiProperty() id!: string;
  @ApiProperty() conversationId!: string;
  @ApiProperty() senderId!: string;
  @ApiProperty() recipientId!: string;
  @ApiProperty() content!: string;
  @ApiProperty() timestamp!: string;
  @ApiProperty({ enum: PRIORITIES }) priority!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty({ example: 0.25 }) cost!: number;
}

export class StatusChangeResponse {
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty() at!: string;
}

export class MessageStatusResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty({ description: 'Tentativas de entrega já feitas' }) attempts!: number;
  @ApiProperty({ type: [StatusChangeResponse] }) history!: StatusChangeResponse[];
}

export class ConversationResponse {
  @ApiProperty() id!: string;
  @ApiProperty() clientId!: string;
  @ApiProperty() recipientId!: string;
  @ApiProperty() recipientName!: string;
  @ApiProperty({ nullable: true, type: String }) lastMessageContent!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastMessageTime!: string | null;
  @ApiProperty({ description: 'Mensagens entregues ainda não lidas' }) unreadCount!: number;
}

class QueueSizeResponse {
  @ApiProperty() urgent!: number;
  @ApiProperty() normal!: number;
  @ApiProperty() total!: number;
}

class AntiStarvationResponse {
  @ApiProperty({ description: 'Máximo de urgentes seguidas com normal esperando' }) urgentBurst!: number;
  @ApiProperty({ description: 'Vezes em que uma normal passou na frente de urgentes' }) preventions!: number;
}

class WorkerResponse {
  @ApiProperty({ enum: ['async', 'sync', 'manual'] }) mode!: string;
  @ApiProperty() running!: boolean;
}

export class QueueStatusResponse {
  @ApiProperty({ type: QueueSizeResponse }) size!: QueueSizeResponse;
  @ApiProperty() enqueued!: number;
  @ApiProperty() processed!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() retried!: number;
  @ApiProperty() averageWaitMs!: number;
  @ApiProperty({ type: AntiStarvationResponse }) antiStarvation!: AntiStarvationResponse;
  @ApiProperty({ type: WorkerResponse }) worker!: WorkerResponse;
}
