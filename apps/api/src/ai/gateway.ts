import { createHash } from 'node:crypto';

import type { AppEnvironment } from '@velora/config/server';
import {
  aiSuggestionResponseSchema,
  type AiSuggestionRequest,
  type AiSuggestionResponse,
  type AuthAudience,
} from '@velora/validation';
import type { SafeLogger } from '@velora/observability/server';

import { minimizeAiInput } from './privacy.js';
import type { AiProvider } from './provider.js';
import { manifestFor } from './registry.js';
import { AiRunConflictError, type AiRepository } from './repository.js';
import { aiTimeoutMilliseconds } from './policy.js';

export type AiGatewayFailure =
  | 'cancelled'
  | 'capability_disabled'
  | 'kill_switch'
  | 'provider_failure'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'run_conflict'
  | 'timeout';

export class AiGatewayError extends Error {
  constructor(readonly kind: AiGatewayFailure) {
    super(`AI Gateway refused: ${kind}`);
    this.name = 'AiGatewayError';
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

interface ActiveRun {
  readonly actorId: string;
  readonly audience: AuthAudience;
  readonly controller: AbortController;
}

/** Explicit bounded orchestration for synchronous suggestion runs. */
export class AiGateway {
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly dependencies: {
      readonly enabled: boolean;
      readonly environment: AppEnvironment;
      readonly logger: SafeLogger;
      readonly now: () => Date;
      readonly provider: AiProvider;
      readonly repository: AiRepository;
      readonly timeoutMilliseconds?: number;
    },
  ) {}

  async suggest(input: {
    readonly actorId: string;
    readonly audience: AuthAudience;
    readonly correlationId: string;
    readonly request: AiSuggestionRequest;
  }): Promise<AiSuggestionResponse> {
    if (!this.dependencies.enabled) throw new AiGatewayError('kill_switch');
    if (this.dependencies.provider.id === 'unavailable') {
      throw new AiGatewayError('provider_unavailable');
    }

    const manifest = manifestFor(input.request.capability);
    if (!this.dependencies.provider.supportedTasks.includes(manifest.task)) {
      throw new AiGatewayError('provider_unavailable');
    }
    const activation = await this.dependencies.repository.capabilityEnabled(
      this.dependencies.environment,
      input.request.capability,
      manifest,
    );
    if (!activation) throw new AiGatewayError('capability_disabled');

    const minimized = minimizeAiInput(input.request);
    const runId = input.request.runId;
    const pins = {
      modelId: this.dependencies.provider.modelId,
      outputSchemaVersion: manifest.outputSchemaVersion,
      promptVersion: manifest.promptVersion,
      providerId: this.dependencies.provider.id,
      safetyVersion: manifest.safetyVersion,
    } as const;
    const inputCharacters = minimized.context.length + minimized.draft.length;
    const now = this.dependencies.now();
    let admitted: boolean;
    try {
      admitted = await this.dependencies.repository.admit({
        actorId: input.actorId,
        audience: input.audience,
        capability: input.request.capability,
        correlationId: input.correlationId,
        inputCharacters,
        inputDigest: digest(
          JSON.stringify({
            capability: input.request.capability,
            ...minimized,
            tone: input.request.tone,
          }),
        ),
        now,
        pins,
        runId,
      });
    } catch (error) {
      if (error instanceof AiRunConflictError) {
        throw new AiGatewayError('run_conflict');
      }
      throw error;
    }
    if (!admitted) throw new AiGatewayError('rate_limited');

    const controller = new AbortController();
    this.active.set(runId, {
      actorId: input.actorId,
      audience: input.audience,
      controller,
    });
    const timeout = { fired: false };
    const timer = setTimeout(() => {
      timeout.fired = true;
      controller.abort();
    }, this.dependencies.timeoutMilliseconds ?? aiTimeoutMilliseconds);

    try {
      let text = '';
      let cost = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          for await (const chunk of this.dependencies.provider.generate(
            {
              capability: input.request.capability,
              context: minimized.context,
              draft: minimized.draft,
              promptVersion: manifest.promptVersion,
              systemPolicy: manifest.systemPolicy,
              tone: input.request.tone,
            },
            controller.signal,
          )) {
            if (
              typeof chunk.text !== 'string' ||
              (chunk.usage !== undefined &&
                (!Number.isSafeInteger(chunk.usage.estimatedCostMicrounits) ||
                  chunk.usage.estimatedCostMicrounits < 0))
            ) {
              throw new Error('AI_OUTPUT_MALFORMED');
            }
            text += chunk.text;
            cost += chunk.usage?.estimatedCostMicrounits ?? 0;
            if (!Number.isSafeInteger(cost)) {
              throw new Error('AI_USAGE_MALFORMED');
            }
            if (text.length > 2_000) throw new Error('AI_OUTPUT_OVERSIZED');
          }
          break;
        } catch (error) {
          if (controller.signal.aborted || text.length > 0 || attempt === 1) {
            throw error;
          }
          this.dependencies.logger.warn(
            { correlationId: input.correlationId, runId },
            'ai provider retry before output',
          );
        }
      }
      if (text.trim().length === 0) throw new Error('AI_OUTPUT_EMPTY');
      const completed = await this.dependencies.repository.complete({
        actorId: input.actorId,
        cost,
        now: this.dependencies.now(),
        outputCharacters: text.length,
        outputDigest: digest(text),
        runId,
      });
      if (!completed) throw new AiGatewayError('cancelled');
      return aiSuggestionResponseSchema.parse({
        capability: input.request.capability,
        modelId: pins.modelId,
        outputSchemaVersion: pins.outputSchemaVersion,
        promptVersion: pins.promptVersion,
        providerId: pins.providerId,
        runId,
        suggestedText: text,
        usage: {
          estimatedCostMicrounits: cost,
          inputCharacters,
          outputCharacters: text.length,
        },
      });
    } catch (error) {
      const kind: AiGatewayFailure =
        error instanceof AiGatewayError && error.kind === 'cancelled'
          ? 'cancelled'
          : timeout.fired
            ? 'timeout'
            : controller.signal.aborted
              ? 'cancelled'
              : 'provider_failure';
      await this.dependencies.repository.fail(
        runId,
        input.actorId,
        kind,
        this.dependencies.now(),
      );
      this.dependencies.logger.warn(
        { correlationId: input.correlationId, kind, runId },
        'ai suggestion did not complete',
      );
      throw new AiGatewayError(kind);
    } finally {
      clearTimeout(timer);
      this.active.delete(runId);
    }
  }

  async cancel(input: {
    readonly actorId: string;
    readonly audience: AuthAudience;
    readonly runId: string;
  }): Promise<boolean> {
    const cancelled = await this.dependencies.repository.cancel(
      input.runId,
      input.actorId,
      input.audience,
      this.dependencies.now(),
    );
    const active = this.active.get(input.runId);
    if (
      cancelled &&
      active?.actorId === input.actorId &&
      active.audience === input.audience
    ) {
      active.controller.abort();
    }
    return cancelled;
  }
}
