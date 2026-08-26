import type { AiSuggestionRequest } from '@velora/validation';

const forbiddenSecretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]/iu,
  /\bbearer\s+[A-Za-z0-9._~+/-]{12,}/iu,
] as const;
const injectionPatterns = [
  /ignore (?:all |the )?(?:previous|prior|system|developer) instructions/iu,
  /reveal (?:the )?(?:system prompt|developer message|secret)/iu,
  /(?:system|developer)\s*message\s*:/iu,
] as const;

export class AiInputRejectedError extends Error {
  constructor(readonly reason: 'secret_like' | 'prompt_injection') {
    super(`AI input rejected: ${reason}`);
    this.name = 'AiInputRejectedError';
  }
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Minimize and reject credential-shaped or instruction-smuggling input. */
export function minimizeAiInput(input: AiSuggestionRequest): {
  readonly context: string;
  readonly draft: string;
} {
  const context = normalize(input.context);
  const draft = normalize(input.draft);
  const combined = `${context}\n${draft}`;
  if (forbiddenSecretPatterns.some((pattern) => pattern.test(combined))) {
    throw new AiInputRejectedError('secret_like');
  }
  if (injectionPatterns.some((pattern) => pattern.test(combined))) {
    throw new AiInputRejectedError('prompt_injection');
  }
  return { context, draft };
}
