import { Message } from '../../domain/message';
import { SimulatedMessageGateway } from '../simulated-message-gateway';

const message = Message.create({
  id: 'm1',
  conversationId: 'cv1',
  senderId: 'c1',
  recipientId: 'r1',
  content: 'Olá',
  priority: 'normal',
  now: new Date(),
});

describe('SimulatedMessageGateway', () => {
  it('sem atraso configurado, conclui a entrega imediatamente', async () => {
    await expect(new SimulatedMessageGateway().deliver(message)).resolves.toBeUndefined();
  });

  it('com PROCESSING_DELAY_MS, a entrega leva pelo menos esse tempo', async () => {
    const started = performance.now();

    await new SimulatedMessageGateway(30).deliver(message);

    expect(performance.now() - started).toBeGreaterThanOrEqual(29);
  });
});
