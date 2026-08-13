declare const opaqueType: unique symbol;

export type Opaque<TValue, TName extends string> = TValue & {
  readonly [opaqueType]: TName;
};

export type CorrelationId = Opaque<string, 'CorrelationId'>;
export type EventId = Opaque<string, 'EventId'>;
export type AggregateId = Opaque<string, 'AggregateId'>;
