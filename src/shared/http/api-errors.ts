import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiResponse } from '@nestjs/swagger';

/** Corpo de toda resposta de erro da API. */
export class ErrorResponse {
  @ApiProperty({ example: 402 })
  statusCode!: number;

  @ApiProperty({ example: 'INSUFFICIENT_BALANCE', description: 'Identificador estável do erro, em maiúsculas' })
  code!: string;

  @ApiProperty({ example: 'Saldo insuficiente para enviar a mensagem' })
  message!: string;

  @ApiPropertyOptional({ example: { balance: 0, cost: 0.25 } })
  details?: Record<string, unknown>;
}

const DESCRIPTIONS: Record<number, string> = {
  400: 'Requisição inválida (VALIDATION_FAILED, INVALID_DOCUMENT, RECIPIENT_REQUIRED, LIMIT_REQUIRED)',
  401: 'Sem credencial válida (UNAUTHORIZED)',
  402: 'Sem saldo ou limite (INSUFFICIENT_BALANCE, LIMIT_EXCEEDED)',
  403: 'Cliente inativo (CLIENT_INACTIVE)',
  404: 'Não encontrado, ou pertence a outro cliente',
  409: 'Conflito (DOCUMENT_ALREADY_REGISTERED, INVALID_STATUS_TRANSITION)',
};

/** Documenta no OpenAPI os status de erro que a rota pode devolver. */
export const ApiErrors = (...statuses: number[]) =>
  applyDecorators(...statuses.map((status) => ApiResponse({ status, type: ErrorResponse, description: DESCRIPTIONS[status] })));
