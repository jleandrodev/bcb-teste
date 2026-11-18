import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { ClientsService } from '../application/clients.service';
import { Client } from '../domain/client';

type AuthedRequest = Request & { client?: Client };

/**
 * Identifica o cliente por `Authorization: Bearer <token>` (obtido em POST /auth)
 * ou pelo cabeçalho `X-Client-Document` (CPF/CNPJ), como pede a Parte 2 do desafio.
 * Sem credencial válida, `resolve` lança UnauthorizedError (401).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly clients: ClientsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const authorization = request.header('authorization') ?? '';
    const token = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : undefined;
    const document = request.header('x-client-document') ?? undefined;
    request.client = await this.clients.resolve({ token, document });
    return true;
  }
}

/** Entrega o cliente autenticado ao handler: `@CurrentClient() client: Client`. */
export const CurrentClient = createParamDecorator((_data: unknown, context: ExecutionContext): Client => {
  return context.switchToHttp().getRequest<AuthedRequest>().client as Client;
});
