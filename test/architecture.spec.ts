import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/*
 * As regras de arquitetura (ADR-002, ADR-007) como teste: se alguém importar o
 * framework no domínio ou atravessar a fronteira de um módulo, a suíte fica vermelha.
 * Lê os imports dos arquivos de produção; não depende de nenhuma ferramenta externa.
 */
const SRC = resolve(__dirname, '..', 'src');

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__test__' ? [] : productionFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

interface Import {
  /** Arquivo que importa, relativo a src (ex.: `messaging/domain/message.ts`). */
  from: string;
  /** O que foi escrito no import (ex.: `@nestjs/common`, `../domain/client`). */
  specifier: string;
  /** Para imports relativos, o destino relativo a src (ex.: `clients/index`). */
  target: string | null;
}

const imports: Import[] = productionFiles(SRC).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map(([, specifier]) => ({
    from: relative(SRC, file),
    specifier,
    target: specifier.startsWith('.') ? relative(SRC, resolve(dirname(file), specifier)) : null,
  })),
);

const describeImport = (i: Import) => `${i.from} importa ${i.specifier}`;
const layerOf = (path: string) => path.split('/')[1];

describe('Arquitetura', () => {
  it('encontra os arquivos de produção (o teste não está passando no vazio)', () => {
    expect(imports.length).toBeGreaterThan(50);
    expect(imports.some((i) => i.from === 'messaging/application/send-message.use-case.ts')).toBe(true);
  });

  it('domínio e fila não importam framework, driver de banco nem biblioteca de validação', () => {
    const pure = imports.filter((i) => /^(clients|messaging|shared)\/(domain|queue)\//.test(i.from));

    const external = pure.filter((i) => i.target === null);

    expect(pure.length).toBeGreaterThan(5);
    expect(external.map(describeImport)).toEqual([]);
  });

  it('domínio e fila só dependem de outro domínio ou fila, nunca de aplicação, HTTP ou infraestrutura', () => {
    const outward = imports
      .filter((i) => /^(clients|messaging|shared)\/(domain|queue)\//.test(i.from))
      .filter((i) => i.target !== null && !['domain', 'queue'].includes(layerOf(i.target)));

    expect(outward.map(describeImport)).toEqual([]);
  });

  it('a aplicação não conhece HTTP nem infraestrutura: fala com o mundo só pelas portas', () => {
    const leaks = imports
      .filter((i) => /^(clients|messaging)\/application\//.test(i.from))
      .filter((i) => i.target !== null && ['http', 'infra'].includes(layerOf(i.target)));

    expect(leaks.map(describeImport)).toEqual([]);
  });

  it('a aplicação não importa driver de banco nem Express', () => {
    const drivers = imports
      .filter((i) => /\/application\//.test(i.from))
      .filter((i) => ['pg', 'express', '@nestjs/swagger'].includes(i.specifier));

    expect(drivers.map(describeImport)).toEqual([]);
  });

  it('messaging só enxerga clients pela API pública (src/clients/index.ts)', () => {
    const crossing = imports.filter((i) => i.from.startsWith('messaging/') && i.target?.startsWith('clients'));

    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.filter((i) => i.target !== 'clients').map(describeImport)).toEqual([]);
  });

  it('clients não depende de messaging', () => {
    const reverse = imports.filter((i) => i.from.startsWith('clients/') && i.target?.startsWith('messaging'));

    expect(reverse.map(describeImport)).toEqual([]);
  });

  it('shared não depende dos módulos de negócio', () => {
    const upward = imports.filter((i) => i.from.startsWith('shared/') && i.target !== null && /^(clients|messaging)/.test(i.target));

    expect(upward.map(describeImport)).toEqual([]);
  });

  it('o driver pg só aparece em infra/postgres', () => {
    const pg = imports.filter((i) => i.specifier === 'pg');

    expect(pg.length).toBeGreaterThan(0);
    expect(pg.filter((i) => !i.from.includes('/infra/postgres/')).map(describeImport)).toEqual([]);
  });

  it('só a composição dos módulos escolhe adaptadores: ninguém mais importa de infra', () => {
    const users = imports
      .filter((i) => i.target !== null && /\/infra\//.test(i.target))
      .filter((i) => !/\/infra\//.test(i.from) && !i.from.endsWith('.module.ts'));

    expect(users.map(describeImport)).toEqual([]);
  });
});
