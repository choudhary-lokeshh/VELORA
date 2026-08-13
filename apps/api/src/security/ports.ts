export interface AuditRecord {
  readonly action: string;
  readonly actorId?: string;
  readonly correlationId: string;
  readonly outcome: 'allowed' | 'denied' | 'failed';
  readonly subjectId?: string;
}

export interface AuditPort {
  record(entry: AuditRecord): Promise<void>;
}

export interface OutboundRequest {
  readonly body?: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: URL;
}

export interface OutboundResponse {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface OutboundHttpPort {
  execute(request: OutboundRequest): Promise<OutboundResponse>;
}

export class DenyAllOutboundHttp implements OutboundHttpPort {
  execute(request: OutboundRequest): Promise<OutboundResponse> {
    void request;
    return Promise.reject(new Error('Outbound networking is not configured'));
  }
}
