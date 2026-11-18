/**
 * Erros de domínio: o domínio não conhece HTTP. Cada erro carrega um `kind`
 * (categoria) e um `code` (identificador estável); a borda HTTP traduz para status.
 */
export type ErrorKind = 'validation' | 'unauthorized' | 'payment_required' | 'forbidden' | 'not_found' | 'conflict';

export class DomainError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('validation', code, message, details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Cliente não autenticado') {
    super('unauthorized', 'UNAUTHORIZED', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super('not_found', `${resource.toUpperCase()}_NOT_FOUND`, `${resource} ${id} não encontrado`);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string) {
    super('conflict', code, message);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(code: 'INSUFFICIENT_BALANCE' | 'LIMIT_EXCEEDED', message: string, details?: Record<string, unknown>) {
    super('payment_required', code, message, details);
  }
}

export class InactiveClientError extends DomainError {
  constructor(clientId: string) {
    super('forbidden', 'CLIENT_INACTIVE', `Cliente ${clientId} está inativo`);
  }
}
