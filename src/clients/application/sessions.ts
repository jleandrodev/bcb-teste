import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Sessões da autenticação simples: token opaco → cliente, em memória (ADR-009).
 * É uma classe concreta, sem porta: só existe uma implementação.
 */
@Injectable()
export class Sessions {
  private readonly clientByToken = new Map<string, string>();

  open(clientId: string): string {
    const token = randomUUID();
    this.clientByToken.set(token, clientId);
    return token;
  }

  clientOf(token: string): string | null {
    return this.clientByToken.get(token) ?? null;
  }
}
