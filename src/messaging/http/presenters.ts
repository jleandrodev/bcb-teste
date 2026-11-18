import { ConversationView } from '../application/messages.service';
import { Message } from '../domain/message';

export function presentMessage(message: Message) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    recipientId: message.recipientId,
    content: message.content,
    timestamp: message.timestamp.toISOString(),
    priority: message.priority,
    status: message.status,
    cost: message.cost.toDecimal(),
  };
}

export function presentStatus(message: Message) {
  return {
    id: message.id,
    status: message.status,
    attempts: message.attempts,
    history: message.history.map((h) => ({ status: h.status, at: h.at.toISOString() })),
  };
}

export function presentConversation(conversation: ConversationView) {
  return {
    id: conversation.id,
    clientId: conversation.clientId,
    recipientId: conversation.recipientId,
    recipientName: conversation.recipientName,
    lastMessageContent: conversation.lastMessageContent,
    lastMessageTime: conversation.lastMessageTime?.toISOString() ?? null,
    unreadCount: conversation.unreadCount,
  };
}
