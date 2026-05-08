// Event-driven system for the platform
type EventHandler = (data: any) => void;

class EventBus {
  private listeners: Map<string, EventHandler[]> = new Map();

  on(event: string, handler: EventHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  emit(event: string, data?: any) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  off(event: string, handler: EventHandler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }
}

export const eventBus = new EventBus();

export const EventTypes = {
  // Shop events
  SHOP_SWITCHED: 'shop.switched',
  // File upload events
  FILE_UPLOADED: 'file.uploaded',
  // Product events
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DISABLED: 'product.disabled',
  PRODUCT_APPROVED: 'product.approved',
  // Message events
  MESSAGE_RECEIVED: 'message.received',
  INTENT_DETECTED: 'intent.detected',
  KNOWLEDGE_RETRIEVED: 'knowledge.retrieved',
  // Order events
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_PROCESSING: 'order.processing',
  ORDER_COMPLETED: 'order.completed',
  ORDER_CANCELLED: 'order.cancelled',
  // Payment events
  PAYMENT_SUCCESS: 'payment.success',
  // Channel events
  CHANNEL_CONNECTED: 'channel.connected',
  CHANNEL_DISCONNECTED: 'channel.disconnected',

  // HITL & AI events
  CONVERSATION_HITL_ACTIVATED: 'conversation.hitl_activated',
  CONVERSATION_HITL_DEACTIVATED: 'conversation.hitl_deactivated',
  AI_SUGGESTION_ACCEPTED: 'ai.suggestion_accepted',
  AI_SUGGESTION_REJECTED: 'ai.suggestion_rejected',

  // RTO events
  ORDER_RTO: 'order.rto',
  CUSTOMER_BLACKLISTED: 'customer.blacklisted',
};
