import { Document } from '../document';

describe('Document', () => {
  it.each([
    ['CPF', '529.982.247-25', '52998224725'],
    ['CPF', '11144477735', '11144477735'],
    ['CPF', '123.456.789-09', '12345678909'], // dígito verificador 0 (resto < 2)
    ['CNPJ', '11.222.333/0001-81', '11222333000181'],
    ['CNPJ', '11444777000161', '11444777000161'],
  ])('aceita %s %s e guarda só os dígitos', (type, raw, digits) => {
    const document = Document.create(type, raw);

    expect(document.value).toBe(digits);
    expect(document.type).toBe(type);
  });

  it.each([
    ['CPF', '52998224724', 'segundo dígito verificador errado'],
    ['CPF', '52998224715', 'primeiro dígito verificador errado'],
    ['CPF', '11111111111', 'todos os dígitos iguais'],
    ['CPF', '5299822472', 'dez dígitos'],
    ['CPF', '', 'vazio'],
    ['CNPJ', '11222333000180', 'dígito verificador errado'],
    ['CNPJ', '00000000000000', 'todos os dígitos iguais'],
    ['CNPJ', '52998224725', 'CPF válido informado como CNPJ'],
    ['CPF', '11222333000181', 'CNPJ válido informado como CPF'],
    ['RG', '52998224725', 'tipo desconhecido'],
  ])('recusa %s "%s" (%s) com INVALID_DOCUMENT', (type, raw) => {
    expect(() => Document.create(type, raw)).toThrow(expect.objectContaining({ code: 'INVALID_DOCUMENT', kind: 'validation' }));
  });

  it('a mesma pessoa escrita com e sem máscara resulta no mesmo valor', () => {
    expect(Document.create('CPF', '529.982.247-25').value).toBe(Document.create('CPF', '52998224725').value);
  });

  it('normaliza um documento vindo de cabeçalho sem exigir o tipo', () => {
    expect(Document.normalize(' 11.222.333/0001-81 ')).toBe('11222333000181');
  });
});
