import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

const DOCUMENT_TYPES = ['CPF', 'CNPJ'];
const PLAN_TYPES = ['prepaid', 'postpaid'];

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
  balance?: number;

  @ApiPropertyOptional({ description: 'Limite mensal em reais (pós-pago)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
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

  @ApiPropertyOptional({ enum: PLAN_TYPES })
  @IsOptional()
  @IsIn(PLAN_TYPES)
  planType?: 'prepaid' | 'postpaid';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  limit?: number;
}

export class AddCreditsDto {
  @ApiProperty({ description: 'Valor em reais' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}
