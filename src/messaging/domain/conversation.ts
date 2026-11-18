/** Conversa de um cliente com um destinatário. Existe uma por par (cliente, destinatário). */
export interface Conversation {
  readonly id: string;
  readonly clientId: string;
  readonly recipientId: string;
  readonly recipientName: string;
}
