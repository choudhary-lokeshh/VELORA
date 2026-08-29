'use client';

import { useEffect, useRef, useState } from 'react';

import { failureMessage, type AiSuggestionBody } from '@velora/consumer-client';

import { useApi } from '../app/providers';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Notice,
  Select,
  TextArea,
} from '../design/primitives';

type ConsumerAiCapability = Extract<
  AiSuggestionBody['capability'],
  'consumer_profile_bio' | 'consumer_chat_reply'
>;

const profileTones = ['warm', 'clear', 'confident'] as const;
const chatTones = ['friendly', 'confident', 'playful', 'flirtatious'] as const;
type UiTone = (typeof profileTones)[number] | (typeof chatTones)[number];

function apiTone(tone: UiTone): AiSuggestionBody['tone'] {
  return tone === 'friendly' ? 'warm' : tone;
}

function isTone(value: string, tones: readonly UiTone[]): value is UiTone {
  return tones.some((tone) => tone === value);
}

/**
 * A suggestion workbench, not an action control. Text stays in React state
 * until its owner explicitly replaces the adjacent form draft, and the form's
 * existing Save or Send action remains a separate decision.
 *
 * `folded` is for the places where the workbench is not the work. A profile
 * form is a bench already, and a panel among its fields belongs there; a
 * conversation is two people talking, and a permanent assistant panel under the
 * composer makes the quietest screen in the product the busiest one. Folded, it
 * is one control until somebody asks for it — and it is the same panel, with
 * the same words about what it has and has not done, once they do.
 */
export function ConsumerAiAssist({
  capability,
  draft,
  folded = false,
  onReplace,
  testId,
}: {
  readonly capability: ConsumerAiCapability;
  readonly draft: string;
  readonly folded?: boolean;
  readonly onReplace: (text: string) => void;
  readonly testId: string;
}) {
  const api = useApi();
  const controller = useRef<AbortController | undefined>(undefined);
  const activeRunId = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined);
  const [tone, setTone] = useState<UiTone>(
    capability === 'consumer_chat_reply' ? 'friendly' : 'warm',
  );
  const [open, setOpen] = useState(!folded);
  const tones = capability === 'consumer_chat_reply' ? chatTones : profileTones;

  useEffect(
    () => () => {
      const runId = activeRunId.current;
      activeRunId.current = undefined;
      controller.current?.abort();
      if (runId !== undefined) void api.cancelAi(runId);
    },
    [api],
  );

  const generate = () => {
    const runId = crypto.randomUUID();
    const nextController = new AbortController();
    controller.current = nextController;
    activeRunId.current = runId;
    setBusy(true);
    setError(undefined);
    void api
      .suggestAi(
        { capability, draft, runId, tone: apiTone(tone) },
        nextController.signal,
      )
      .then((result) => {
        if (activeRunId.current !== runId) return;
        activeRunId.current = undefined;
        controller.current = undefined;
        setBusy(false);
        if (result.kind !== 'ok') {
          setError(
            failureMessage(result) ?? 'Suggestion unavailable. Try again.',
          );
          return;
        }
        setSuggestion(result.value.suggestedText);
      });
  };

  const cancel = () => {
    const runId = activeRunId.current;
    if (runId === undefined) return;
    activeRunId.current = undefined;
    controller.current?.abort();
    controller.current = undefined;
    setBusy(false);
    setError(undefined);
    void api.cancelAi(runId);
  };

  if (folded && !open) {
    return (
      <div className="v-assist-fold">
        <Button
          data-testid={`${testId}-open`}
          icon="sparkle"
          onClick={() => {
            setOpen(true);
          }}
          size="sm"
          tone="ghost"
        >
          Writing assist
        </Button>
      </div>
    );
  }

  return (
    <Card testId={testId}>
      <div className="v-stack v-stack--4">
        <div className="v-inline v-inline--between">
          <div className="v-stack v-stack--1">
            <p className="v-subheading">Writing assist</p>
            <p className="v-caption v-quiet">
              AI suggestion only. Review and edit it before you use it.
            </p>
          </div>
          {folded ? (
            <Button
              data-testid={`${testId}-close`}
              onClick={() => {
                cancel();
                setOpen(false);
              }}
              size="sm"
              tone="ghost"
            >
              Hide
            </Button>
          ) : null}
        </div>

        <label className="v-field__label" htmlFor={`${testId}-tone`}>
          Tone
        </label>
        <Select
          data-testid={`${testId}-tone`}
          disabled={busy}
          id={`${testId}-tone`}
          onChange={(event) => {
            if (isTone(event.target.value, tones)) setTone(event.target.value);
          }}
          value={tone}
        >
          {tones.map((option) => (
            <option key={option} value={option}>
              {option[0]?.toUpperCase()}
              {option.slice(1)}
            </option>
          ))}
        </Select>

        <div className="v-inline">
          <Button
            busy={busy}
            data-testid={`${testId}-generate`}
            disabled={busy}
            onClick={generate}
            tone="secondary"
          >
            {error !== undefined
              ? 'Try again'
              : suggestion === undefined
                ? 'Generate suggestion'
                : 'Regenerate'}
          </Button>
          {busy ? (
            <Button
              data-testid={`${testId}-cancel`}
              onClick={cancel}
              tone="ghost"
            >
              Cancel
            </Button>
          ) : null}
        </div>

        <p aria-live="polite" className="v-visually-hidden">
          {busy ? 'Generating an AI suggestion.' : (error ?? '')}
        </p>
        {error === undefined ? null : (
          <ErrorMessage testId={`${testId}-error`}>{error}</ErrorMessage>
        )}
        {suggestion === undefined ? null : (
          <>
            <Notice testId={`${testId}-notice`} tone="quiet">
              Suggested text is editable and has not been saved or sent.
            </Notice>
            <Field label="Suggested text">
              {(control) => (
                <TextArea
                  {...control}
                  data-testid={`${testId}-suggestion`}
                  onChange={(event) => {
                    setSuggestion(event.target.value);
                  }}
                  rows={4}
                  value={suggestion}
                />
              )}
            </Field>
            <div>
              <Button
                data-testid={`${testId}-replace`}
                disabled={suggestion.trim().length === 0}
                onClick={() => {
                  onReplace(suggestion);
                }}
              >
                Replace draft
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
