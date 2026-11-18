import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Formato das respostas no OpenAPI. Os presenters montam os objetos; estas classes só os descrevem. */
export class ClientResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '52998224725', description: 'Só dígitos' }) documentId!: string;
  @ApiProperty({ enum: ['CPF', 'CNPJ'] }) documentType!: string;
  @ApiProperty({ enum: ['prepaid', 'postpaid'] }) planType!: string;
  @ApiPropertyOptional({ description: 'Saldo em reais (pré-pago)' }) balance?: number;
  @ApiPropertyOptional({ description: 'Limite mensal em reais (pós-pago)' }) limit?: number;
  @ApiProperty() active!: boolean;
}

export class AuthResponse {
  @ApiProperty({ description: 'Enviar em Authorization: Bearer <token>' }) token!: string;
  @ApiProperty({ type: ClientResponse }) client!: ClientResponse;
}

export class BalanceResponse {
  @ApiProperty() clientId!: string;
  @ApiProperty({ enum: ['prepaid', 'postpaid'] }) planType!: string;
  @ApiPropertyOptional({ description: 'Pré-pago: saldo em reais' }) balance?: number;
  @ApiPropertyOptional({ description: 'Pós-pago: limite mensal' }) limit?: number;
  @ApiPropertyOptional({ description: 'Pós-pago: consumo do mês corrente' }) used?: number;
  @ApiProperty({ description: 'Quanto ainda pode ser gasto' }) available!: number;
}

export class TransactionResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['credit', 'debit', 'refund'] }) type!: string;
  @ApiProperty({ description: 'Valor em reais' }) amount!: number;
  @ApiPropertyOptional({ description: 'Mensagem que originou o débito ou o estorno' }) messageId?: string;
  @ApiProperty() createdAt!: string;
}
