// Legacy compat — use ConversationLedger directly.
// MessageBus was the original name; ConversationLedger is the current canonical name.

export { ConversationLedger } from "./conversation-ledger.js";
/** @deprecated Use ConversationLedger instead. */
export { ConversationLedger as MessageBus } from "./conversation-ledger.js";
