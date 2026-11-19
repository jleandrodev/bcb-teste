/**
 * O que a checagem de saúde precisa saber da infraestrutura, sem conhecê-la:
 * onde os dados são gravados e se esse lugar está respondendo.
 */
export interface Readiness {
  readonly persistence: 'memory' | 'postgres';
  /** Nunca lança: indisponibilidade é resposta, não erro. */
  isReady(): Promise<boolean>;
}

export const READINESS = Symbol('Readiness');
