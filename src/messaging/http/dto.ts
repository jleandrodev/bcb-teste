import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const PRIORITIES = ['normal', 'urgent'];
const STATUSES = ['queued', 'processing', 'sent', 'delivered', 'read', 'failed'];

export class SendMessageDto {
  @ApiPropertyOptional({ description: 'Conversa existente. Se ausente, usa/cria a conversa com recipientId.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  conversationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  recipientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @ApiProperty({ description: 'Texto da mensagem. Espaços nas pontas são removidos; só espaços não é conteúdo.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
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
