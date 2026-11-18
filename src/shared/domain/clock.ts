/** Porta de relógio: o domínio pergunta a hora a uma abstração, o que torna o tempo testável. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
