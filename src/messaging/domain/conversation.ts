export interface Conversation {
  readonly id: string;
  readonly clientId: string;
  readonly recipientId: string;
  readonly recipientName: string;
  readonly lastMessageContent: string | null;
  readonly lastMessageTime: Date | null;
}
