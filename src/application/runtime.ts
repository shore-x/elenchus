// Elenchus - Runtime Factory
// The application layer exposes a stable session factory to CLI and future UI adapters.

import { DeliberationSession, type DeliberationSessionOptions } from "./session.js";

export function createSession(options: DeliberationSessionOptions): DeliberationSession {
  return new DeliberationSession(options);
}

export type { DeliberationSessionOptions } from "./session.js";
