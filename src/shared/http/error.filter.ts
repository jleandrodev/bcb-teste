import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError, ErrorKind } from '../domain/errors';

const STATUS_BY_KIND: Record<ErrorKind, number> = {
  validation: HttpStatus.BAD_REQUEST,
  unauthorized: HttpStatus.UNAUTHORIZED,
  payment_required: HttpStatus.PAYMENT_REQUIRED,
  forbidden: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
};

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Único lugar que sabe traduzir erro em resposta HTTP. Toda resposta de erro da
 * API sai no mesmo corpo `{ statusCode, code, message, details? }`:
 * erro de negócio, erro do framework (rota inexistente, JSON malformado) e erro inesperado.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const body = this.toBody(error);
    host.switchToHttp().getResponse<Response>().status(body.statusCode).json(body);
  }

  /**
   * Erros 4xx que não nascem no domínio: os do Nest (rota inexistente) e os do
   * leitor de corpo do Express (JSON malformado, corpo grande demais), que
   * carregam o status em `status`. Um 5xx vindo daí é tratado como inesperado.
   */
  private clientErrorStatus(error: unknown): number | null {
    const status = error instanceof HttpException ? error.getStatus() : (error as { status?: unknown } | null)?.status;
    return error instanceof Error && typeof status === 'number' && status >= 400 && status < 500 ? status : null;
  }

  private toBody(error: unknown): ErrorBody {
    if (error instanceof DomainError) {
      return { statusCode: STATUS_BY_KIND[error.kind], code: error.code, message: error.message, details: error.details };
    }
    const clientError = this.clientErrorStatus(error);
    if (clientError) {
      return { statusCode: clientError, code: HttpStatus[clientError] ?? 'HTTP_ERROR', message: (error as Error).message };
    }
    // Erro que ninguém previu: o detalhe vai para o log, nunca para o cliente da API.
    this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR', message: 'Erro interno' };
  }
}
