import type { AggregateId, CorrelationId, EventId } from '@velora/types';

export interface DomainEventEnvelope<TPayload> {
  readonly aggregateId: AggregateId;
  readonly aggregateVersion: number;
  readonly correlationId: CorrelationId;
  readonly dataClassification: string;
  readonly eventId: EventId;
  readonly eventName: string;
  readonly occurredAt: string;
  readonly payload: Readonly<TPayload>;
  readonly producer: string;
  readonly schemaVersion: number;
}

export interface OutboxWriter<TTransaction = unknown> {
  append<TPayload>(
    transaction: TTransaction,
    event: DomainEventEnvelope<TPayload>,
  ): Promise<void>;
}

export interface InboxDeduplicator<TTransaction = unknown> {
  hasProcessed(transaction: TTransaction, eventId: EventId): Promise<boolean>;
  markProcessed(transaction: TTransaction, eventId: EventId): Promise<void>;
}
