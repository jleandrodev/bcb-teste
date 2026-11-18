import { ValidationError } from '../../shared/domain/errors';

export type DocumentType = 'CPF' | 'CNPJ';

const onlyDigits = (value: string): string => value.replace(/\D/g, '');
const allSameDigit = (digits: string): boolean => /^(\d)\1+$/.test(digits);

/** Dígito verificador módulo 11: soma ponderada; resto < 2 vira 0, senão 11 - resto. */
function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isValidCpf(d: string): boolean {
  if (d.length !== 11 || allSameDigit(d)) return false;
  const first = checkDigit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[9]) && second === Number(d[10]);
}

function isValidCnpj(d: string): boolean {
  if (d.length !== 14 || allSameDigit(d)) return false;
  const first = checkDigit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[12]) && second === Number(d[13]);
}

/**
 * Value object de CPF/CNPJ. Um Document existente é sempre válido e normalizado
 * (só dígitos), então o resto do sistema nunca precisa revalidar.
 */
export class Document {
  private constructor(
    readonly type: DocumentType,
    readonly value: string,
  ) {}

  static create(type: string, raw: string): Document {
    const digits = onlyDigits(String(raw ?? ''));
    if (type === 'CPF' && isValidCpf(digits)) return new Document('CPF', digits);
    if (type === 'CNPJ' && isValidCnpj(digits)) return new Document('CNPJ', digits);
    throw new ValidationError('INVALID_DOCUMENT', `${type === 'CNPJ' ? 'CNPJ' : 'CPF'} inválido`);
  }

  /** Normaliza um documento vindo de header/busca sem exigir o tipo. */
  static normalize(raw: string): string {
    return onlyDigits(String(raw ?? ''));
  }
}
