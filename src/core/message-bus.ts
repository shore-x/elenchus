// Elenchus MVP - MessageBus
// Implements P1 (Uniform Message Model) and P4 (Turn Visibility Boundary).
// All external inputs are uniform Messages. Visibility is determined at turn start.
// User messages can arrive asynchronously at any time — they are buffered and
// only become visible at the next turn boundary.

export { ConversationLedger as MessageBus } from "./conversation-ledger.js";
