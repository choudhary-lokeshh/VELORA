import { failureMessage, type AiSuggestionBody } from '@velora/consumer-client';
import { useEffect, useRef, useState } from 'react';

import { mintUuid } from '../device/installation';
import { useApi } from '../frame/providers';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Notice,
  Stack,
  Text,
  TextField,
} from '../design/primitives';

type MobileAiCapability = Extract<
  AiSuggestionBody['capability'],
  'consumer_profile_bio' | 'consumer_chat_reply'
>;

/**
 * The run identity the contract requires, which must be a real UUID.
 *
 * Hermes has no `globalThis.crypto`, so reading `randomUUID` from it throws on
 * a device even though it works under the test renderer. The platform sources
 * this build already relies on for its installation identifier are the ones
 * that exist here too, and the contract rejects anything that is not a UUID,
 * so the sibling identifier fallbacks in this directory are not usable.
 */
function createAiRunId(): string {
  return mintUuid();
}

/** Editable local text only. Save and Send remain explicit controls elsewhere. */
export function MobileAiAssist({
  capability,
  draft,
  onReplace,
  testID,
}: {
  readonly capability: MobileAiCapability;
  readonly draft: string;
  readonly onReplace: (text: string) => void;
  readonly testID: string;
}) {
  const api = useApi();
  const controller = useRef<AbortController | undefined>(undefined);
  const activeRunId = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined);

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
    let runId: string;
    try {
      runId = createAiRunId();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Suggestion unavailable.',
      );
      return;
    }
    const nextController = new AbortController();
    activeRunId.current = runId;
    controller.current = nextController;
    setBusy(true);
    setError(undefined);
    void api
      .suggestAi(
        {
          capability,
          draft,
          runId,
          tone: capability === 'consumer_chat_reply' ? 'warm' : 'clear',
        },
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

  return (
    <Card testID={testID} tone="surface2">
      <Stack gap={3}>
        <Stack gap={1}>
          <Text variant="subheading" weight="semibold">
            Writing assist
          </Text>
          <Text tone="secondary" variant="caption">
            AI suggests editable text only. It never saves or sends for you.
          </Text>
        </Stack>
        <Button
          busy={busy}
          disabled={busy}
          icon="sparkle"
          onPress={generate}
          testID={`${testID}-generate`}
          tone="secondary"
          wide
        >
          {error !== undefined
            ? 'Try again'
            : suggestion === undefined
              ? 'Generate suggestion'
              : 'Regenerate'}
        </Button>
        {busy ? (
          <Button
            onPress={cancel}
            testID={`${testID}-cancel`}
            tone="ghost"
            wide
          >
            Cancel
          </Button>
        ) : null}
        {error === undefined ? null : (
          <ErrorMessage testID={`${testID}-error`}>{error}</ErrorMessage>
        )}
        {suggestion === undefined ? null : (
          <>
            <Notice
              testID={`${testID}-notice`}
              title="Review before using"
              tone="neutral"
            >
              Suggested text is editable and is not yet used.
            </Notice>
            <Field label="Suggested text" testID={`${testID}-suggestion-field`}>
              {(control) => (
                <TextField
                  {...control}
                  multiline
                  onChangeText={setSuggestion}
                  testID={`${testID}-suggestion`}
                  value={suggestion}
                />
              )}
            </Field>
            <Button
              disabled={suggestion.trim().length === 0}
              onPress={() => {
                onReplace(suggestion);
              }}
              testID={`${testID}-use`}
              tone="primary"
              wide
            >
              Use in draft
            </Button>
          </>
        )}
      </Stack>
    </Card>
  );
}
