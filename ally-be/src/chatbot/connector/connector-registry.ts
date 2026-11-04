import { Injectable } from '@nestjs/common';
import type { ChannelCapabilities } from '../engine/chatbot-engine.types';

/** How one connector looks on its card. Type-specific detail stays in `details`. */
export interface ConnectorSummary {
  /** e.g. "+1 555-168-6513" for WhatsApp. */
  address: string | null;
  status: string;
  lastError: string | null;
  /** When it last received a message — the proof the setup works end to end. */
  lastInboundAt: Date | null;
  details: Record<string, unknown>;
}

/**
 * A kind of connector (WhatsApp, Slack, IVR…). Each lives in its own module and registers itself on
 * start-up; the chatbot side only ever talks to this interface, so adding a channel is a new module
 * and nothing in the chatbot code changes.
 *
 * Creating a connector is the type's own flow (WhatsApp's connect stepper checks the credentials
 * with Meta before anything is stored); the type calls ConnectorService.create when it succeeds.
 */
export interface ConnectorTypeDefinition {
  type: string;
  label: string;
  description: string;
  capabilities: ChannelCapabilities;
  summarise(connectorIds: string[]): Promise<Map<string, ConnectorSummary>>;
  /** Tear down the type's side (wipe credentials, stop receiving). */
  disconnect(connectorId: string): Promise<void>;
}

@Injectable()
export class ConnectorRegistry {
  private readonly types = new Map<string, ConnectorTypeDefinition>();

  register(definition: ConnectorTypeDefinition): void {
    this.types.set(definition.type, definition);
  }

  get(type: string): ConnectorTypeDefinition | undefined {
    return this.types.get(type);
  }

  list(): ConnectorTypeDefinition[] {
    return [...this.types.values()];
  }
}
