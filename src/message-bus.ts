// Elenchus MVP - MessageBus
// Implements P1 (Uniform Message Model) and P4 (Turn Visibility Boundary).
// All external inputs are uniform Messages. Visibility is determined at turn start.
// User messages can arrive asynchronously at any time — they are buffered and
// only become visible at the next turn boundary.

import { AgentId, BusMessage, MessageSource } from "./types.js";

let nextId = 0;
function generateId(): string {
  return `msg-${++nextId}-${Date.now()}`;
}

export class MessageBus {
  private messages: BusMessage[] = [];
  // Per-agent read cursors: index of the next unread message
  private cursors: Record<AgentId, number> = {
    "agent-a": 0,
    "agent-b": 0,
  };

  // Write a message to the bus. Can be called at any time (async-safe).
  write(source: MessageSource, content: string, proposal?: BusMessage["proposal"]): BusMessage {
    const msg: BusMessage = {
      id: generateId(),
      source,
      content,
      timestamp: Date.now(),
      proposal,
    };
    this.messages.push(msg);
    return msg;
  }

  // Read new messages for an agent (called at turn start).
  // Advances the cursor so these messages won't be returned again.
  readNewForAgent(agent: AgentId): BusMessage[] {
    const cursor = this.cursors[agent];
    const newMessages = this.messages.slice(cursor);
    this.cursors[agent] = this.messages.length;
    return newMessages;
  }

  // Peek at new messages without advancing the cursor.
  peekNewForAgent(agent: AgentId): BusMessage[] {
    const cursor = this.cursors[agent];
    return this.messages.slice(cursor);
  }

  // Check if there are unread messages for an agent.
  hasNewMessages(agent: AgentId): boolean {
    return this.cursors[agent] < this.messages.length;
  }

  // Read all messages (for debugging / logging).
  readAll(): readonly BusMessage[] {
    return this.messages;
  }
}
