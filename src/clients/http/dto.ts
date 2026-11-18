import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

const DOCUMENT_TYPES = ['CPF', 'CNPJ'];
const PLAN_TYPES = ['prepaid', 'postpaid'];
/** Teto de qualquer valor em reais aceito pela API: muito acima do uso real e seguro para a aritmética em centavos. */
const MAX_AMOUNT = 1_000_000_000;

export class AuthDto {
  @ApiProperty({ example: '52998224725' })
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  documentType!: string;
}

export class CreateClientDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '52998224725' })
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  documentType!: string;

  @ApiProperty({ enum: PLAN_TYPES })
  @IsIn(PLAN_TYPES)
  planType!: 'prepaid' | 'postpaid';

  @ApiPropertyOptional({ description: 'Saldo inicial em reais (pré-pago)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  balance?: number;

  @ApiPropertyOptional({ description: 'Limite mensal em reais (pós-pago)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  limit?: number;
}

export class UpdateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: PLAN_TYPES, description: 'Converte o plano. Saldo residual e consumo pendente são preservados.' })
  @IsOptional()
  @IsIn(PLAN_TYPES)
  planType?: 'prepaid' | 'postpaid';

  @ApiPropertyOptional({ description: 'Limite mensal em reais (obrigatório ao converter para pós-pago um cliente sem limite)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  limit?: number;
}

export class AddCreditsDto {
  @ApiProperty({ description: 'Valor em reais' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_AMOUNT)
  amount!: number;
}
