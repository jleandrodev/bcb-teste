# ADR-004: Fila em memória com dois níveis e limite de rajada contra starvation

- **Data**: 2026-11-18
- **Status**: Aceito
- **Decisores**: Jhonatan Leandro
- **Tags**: estrutura de dados, fila

## Contexto e problema

O desafio pede uma fila em memória com dois níveis de prioridade e proteção contra starvation, e reserva 30% da avaliação para a estrutura de dados. Com prioridade estrita, um fluxo contínuo de urgentes faz uma mensagem normal, já paga, esperar para sempre. O enunciado exige a proteção e não define a regra.

## Direcionadores

- Enfileirar e desenfileirar em tempo constante.
- Ordem de chegada preservada dentro de cada nível.
- Limite de espera das normais que se possa demonstrar e testar.
- Comportamento determinístico: mesma entrada, mesma saída.

## Opções consideradas

**Estrutura**
- Lista ligada com ponteiro de cauda, uma por nível
- Array com `shift()`
- Heap binário único
- Buffer circular

**Política contra starvation**
- Limite de rajada: após N urgentes consecutivas com normal esperando, sai uma normal
- Aging: promover a normal que espera há mais de X
- Weighted round robin
- Menor prazo primeiro (EDF)

## Decisão

**Duas `LinkedQueue` (urgente e normal) dentro de `PriorityMessageQueue`, com limite de rajada.** Após `URGENT_BURST` urgentes consecutivas (padrão 3) *enquanto houver normal esperando*, a próxima a sair é uma normal e o contador zera. O contador só avança com normal esperando: sem ninguém para passar fome, não há o que limitar.

Garantias:

- A normal na frente da fila espera no máximo `URGENT_BURST` urgentes.
- A k-ésima normal espera no máximo `k × (URGENT_BURST + 1)` saídas.
- Sob enxurrada contínua de urgentes, as normais ficam com `1 / (URGENT_BURST + 1)` da vazão (25% com o padrão).
- Todas as operações são O(1).

A fila guarda só a referência da mensagem (`messageId`, prioridade, instante); o conteúdo e o status vivem no repositório.

### Consequências positivas

- Sem relógio dentro da estrutura: os testes são exatos, incluindo um teste de propriedade com sequências geradas.
- `snapshot()` expõe tamanhos, totais e quantas vezes a proteção atuou, o que alimenta `/queue/status`.

### Consequências negativas

- A regra não considera *há quanto tempo* a normal espera. Se o requisito passar a ser "nenhuma normal espera mais de 30 s", a política certa é aging.
- A fila se perde se o processo cair. Com PostgreSQL as mensagens persistem e a fila é reconstruída no boot (ADR-007); em modo memória a perda é total e está documentada.
- Funciona em um processo. Duas instâncias teriam duas filas.

## Opções rejeitadas

- **Array com `shift()`**: O(n) por remoção; esvaziar a fila vira O(n²).
- **Heap**: O(log n) e não preserva ordem de chegada entre iguais sem número de sequência. Passa a ser a escolha certa com muitas prioridades ou prioridade contínua.
- **Buffer circular**: O(1) e mais compacto, com código de redimensionamento que este volume não justifica.
- **Aging**: justo em tempo real, mas depende de relógio, o limite passa a depender da taxa de consumo e os testes ficam mais frágeis.
- **Broker externo**: tiraria do código a estrutura de dados que o desafio pede para avaliar.
