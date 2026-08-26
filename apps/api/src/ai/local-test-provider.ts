import type {
  AiProvider,
  AiProviderChunk,
  AiProviderRequest,
} from './provider.js';

function sentence(value: string): string {
  if (value.length === 0) return value;
  const capitalized = `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
  return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
}

function deterministicDraft(input: AiProviderRequest): string {
  const supplied = input.draft || input.context;
  if (supplied.length > 0) {
    const clean = sentence(supplied);
    if (input.capability === 'consumer_chat_reply') {
      if (input.tone === 'playful')
        return `Okay, you have my attention — ${clean}`;
      if (input.tone === 'flirtatious')
        return `You have my attention — ${clean}`;
      if (input.tone === 'confident') return `I’d say this clearly: ${clean}`;
    }
    if (input.capability === 'admin_case_summary') {
      return `AI-generated record summary: ${clean}`;
    }
    return clean;
  }
  if (input.capability === 'consumer_chat_reply') {
    return 'What’s something you’ve been looking forward to lately?';
  }
  if (input.capability === 'creator_content_idea') {
    return 'Share one true behind-the-scenes detail about how your next piece came together.';
  }
  return 'Start with one true detail you want people to know, then add why it matters to you.';
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

/** Deterministic, network-free adapter used only in local/test environments. */
export class LocalTestAiProvider implements AiProvider {
  readonly id = 'local-test';
  readonly modelId = 'velora-local-deterministic-v1';
  readonly supportedTasks = ['text_suggestion'] as const;

  async *generate(
    input: AiProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<AiProviderChunk> {
    await Promise.resolve();
    throwIfAborted(signal);
    const output = deterministicDraft(input);
    const midpoint = Math.max(1, Math.ceil(output.length / 2));
    for (const text of [output.slice(0, midpoint), output.slice(midpoint)]) {
      throwIfAborted(signal);
      if (text.length > 0) yield { text };
    }
    yield { text: '', usage: { estimatedCostMicrounits: 0 } };
  }
}
