import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../shared/http/trim';

const PRIORITIES = ['normal', 'urgent'];
/** Teto para identificadores e nomes recebidos: nada disso precisa de mais, e texto sem limite é porta para abuso. */
const ID_MAX_LENGTH = 120;
const STATUSES = ['queued', 'processing', 'sent', 'delivered', 'read', 'failed'];

export class SendMessageDto {
  @ApiPropertyOptional({ description: 'Conversa existente. Se ausente, usa/cria a conversa com recipientId.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ID_MAX_LENGTH)
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Identificador do destinatário (telefone, e-mail, id externo)' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ID_MAX_LENGTH)
  recipientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ID_MAX_LENGTH)
  recipientName?: string;

  @ApiProperty({ description: 'Texto da mensagem. Espaços nas pontas são removidos; só espaços não é conteúdo.' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;

  @ApiPropertyOptional({ enum: PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: 'normal' | 'urgent';
}

export class ListMessagesQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX_LENGTH)
  conversationId?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: 'queued' | 'processing' | 'sent' | 'delivered' | 'read' | 'failed';

  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: 'normal' | 'urgent';
}
