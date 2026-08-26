export interface AiProviderRequest {
  readonly capability: string;
  readonly context: string;
  readonly draft: string;
  readonly promptVersion: string;
  readonly systemPolicy: string;
  readonly tone: string;
}

export interface AiProviderChunk {
  readonly text: string;
  readonly usage?: {
    readonly estimatedCostMicrounits: number;
  };
}

export const aiTasks = ['text_suggestion'] as const;
export type AiTask = (typeof aiTasks)[number];

/** Provider-neutral streaming/cancellation contract. */
export interface AiProvider {
  readonly id: string;
  readonly modelId: string;
  readonly supportedTasks: readonly AiTask[];
  generate(
    input: AiProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<AiProviderChunk>;
}

export class UnavailableAiProvider implements AiProvider {
  readonly id = 'unavailable';
  readonly modelId = 'unavailable';
  readonly supportedTasks = [];

  generate(): AsyncIterable<AiProviderChunk> {
    throw new Error('AI_PROVIDER_UNAVAILABLE');
  }
}
