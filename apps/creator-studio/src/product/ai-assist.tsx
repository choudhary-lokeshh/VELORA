'use client';

import { useEffect, useRef, useState } from 'react';

import { failureMessage, type AiSuggestionBody } from '@velora/creator-client';

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

type CreatorAiCapability = Extract<
  AiSuggestionBody['capability'],
  | 'creator_profile_bio'
  | 'creator_content_caption'
  | 'creator_content_title'
  | 'creator_content_description'
  | 'creator_content_idea'
  | 'creator_club_announcement'
>;

const studioTones = [
  'clear',
  'warm',
  'confident',
  'playful',
  'concise',
] as const;
type StudioTone = (typeof studioTones)[number];

function isStudioTone(value: string): value is StudioTone {
  return studioTones.some((tone) => tone === value);
}

function capabilityLabel(capability: CreatorAiCapability): string {
  switch (capability) {
    case 'creator_profile_bio':
      return 'Bio draft';
    case 'creator_content_caption':
      return 'Caption draft';
    case 'creator_content_title':
      return 'Title draft';
    case 'creator_content_description':
      return 'Description draft';
    case 'creator_content_idea':
      return 'Content idea';
    case 'creator_club_announcement':
      return 'Club announcement';
  }
}

/**
 * The assistant deliberately owns no creator record. It returns editable text
 * only; its adjacent normal form remains the sole way to save or publish.
 */
export function CreatorAiAssist({
  capability,
  draft,
  onReplace,
  testId,
}: {
  readonly capability: CreatorAiCapability;
  readonly draft: string;
  readonly onReplace: (text: string) => void;
  readonly testId: string;
}) {
  const api = useApi();
  const controller = useRef<AbortController | undefined>(undefined);
  const activeRunId = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined);
  const [tone, setTone] = useState<StudioTone>('warm');

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
    activeRunId.current = runId;
    controller.current = nextController;
    setBusy(true);
    setError(undefined);
    void api
      .suggestAi({ capability, draft, runId, tone }, nextController.signal)
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

  return (
    <Card testId={testId}>
      <div className="s-stack s-stack--3">
        <div className="s-stack s-stack--1">
          <p className="s-subheading">
            Studio draft assist · {capabilityLabel(capability)}
          </p>
          <p className="s-caption s-quiet">
            AI only proposes text. Review it, then choose whether to use it.
          </p>
        </div>
        <Field label="Tone">
          {(control) => (
            <Select
              {...control}
              data-testid={`${testId}-tone`}
              disabled={busy}
              onChange={(event) => {
                if (isStudioTone(event.target.value))
                  setTone(event.target.value);
              }}
              value={tone}
            >
              {studioTones.map((option) => (
                <option key={option} value={option}>
                  {option[0]?.toUpperCase()}
                  {option.slice(1)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="s-inline">
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
                ? 'Generate draft'
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
        <p aria-live="polite" className="s-visually-hidden">
          {busy ? 'Generating an AI draft.' : (error ?? '')}
        </p>
        {error === undefined ? null : (
          <ErrorMessage testId={`${testId}-error`}>{error}</ErrorMessage>
        )}
        {suggestion === undefined ? null : (
          <>
            <Notice testId={`${testId}-notice`} tone="quiet">
              This is an editable draft. It has not been saved or published.
            </Notice>
            <Field label="Suggested draft">
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
                Use in draft
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
