import { Transform } from 'class-transformer';

/**
 * Remove espaços nas pontas de um texto vindo da requisição, antes da validação.
 * Assim "só espaços" vira vazio e é recusado por `@IsNotEmpty`.
 */
export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
