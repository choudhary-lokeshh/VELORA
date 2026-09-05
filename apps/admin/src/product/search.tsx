'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { SubjectMatch } from '../api/contract';
import {
  Button,
  EmptyState,
  Field,
  Panel,
  PanelBody,
  PanelHead,
  TextInput,
} from '../design/primitives';
import { useApi } from '../app/providers';
import { humanState, shortId } from './format';
import { useSingleFlight } from './resource';

/**
 * One box an operator pastes an identifier into.
 *
 * It resolves; it does not suggest. There is no prefix matching here and no
 * autocomplete, because a suggestion list over identifiers is an enumeration
 * tool — type three characters, learn what exists. Every lookup is an exact
 * match on something the operator already holds, so a wrong guess reveals only
 * that it was wrong.
 *
 * A match is a pointer rather than a record: a kind, an identifier, and a word
 * of context. Following it opens the screen that owns that record, where that
 * screen's own capability check applies. Finding a case does not read the case.
 *
 * It is submitted rather than typed-through. A request per keystroke would put
 * a stream of half-typed identifiers into the API's logs for no gain, and
 * nothing here is fast enough to matter for a value somebody pasted.
 */

const destinations: Readonly<
  Record<SubjectMatch['kind'], (id: string) => string>
> = {
  account: (id) => `/accounts/${id}`,
  case: (id) => `/queues/${id}`,
  conversation: () => '/queues',
  creator: (id) => `/creators?adminSearch=${id}`,
  encounter: (id) => `/platform/live/${id}`,
  invite: () => '/platform/growth',
  payment: (id) => `/money/payments/${id}`,
  report: (id) => `/queues/${id}`,
  ticket: () => '/queues/support',
};

const kindLabels: Readonly<Record<SubjectMatch['kind'], string>> = {
  account: 'Account',
  case: 'Safety case',
  conversation: 'Conversation',
  creator: 'Creator',
  encounter: 'Live encounter',
  invite: 'Invitation',
  payment: 'Payment',
  report: 'Report',
  ticket: 'Support ticket',
};

export function SubjectSearchPanel() {
  const api = useApi();
  const { busy, run } = useSingleFlight();
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<readonly SubjectMatch[] | undefined>(
    undefined,
  );
  const [failed, setFailed] = useState(false);

  const submit = () => {
    const value = term.trim();
    if (value.length === 0) return;
    run(async () => {
      const result = await api.findSubject(value);
      if (result.kind !== 'ok') {
        setFailed(true);
        setMatches(undefined);
        return;
      }
      setFailed(false);
      setMatches(result.value.matches);
    });
  };

  return (
    <Panel testId="subject-search">
      <PanelHead title="Find a record" />
      <PanelBody>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field
            hint="An account, case, encounter, conversation, payment or report identifier; a creator handle; an invitation code; or a support reference."
            label="Identifier"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="subject-search-term"
                onChange={(event) => {
                  setTerm(event.target.value);
                }}
                value={term}
              />
            )}
          </Field>
          <div className="a-toolbar">
            <Button
              busy={busy}
              data-testid="subject-search-submit"
              tone="primary"
              type="submit"
            >
              Find
            </Button>
          </div>
        </form>

        {failed ? (
          <p className="a-small a-muted" data-testid="subject-search-failed">
            The platform could not be asked. Try again.
          </p>
        ) : matches === undefined ? null : matches.length === 0 ? (
          <EmptyState
            body="Nothing on this platform wears that identifier. That is the whole answer — nothing was probed and nothing was disclosed."
            testId="subject-search-empty"
            title="No match"
          />
        ) : (
          <ul
            className="a-stack a-stack--2"
            data-testid="subject-search-results"
          >
            {matches.map((match) => (
              <li key={`${match.kind}:${match.id}`}>
                <Link
                  data-testid={`subject-match-${match.kind}`}
                  href={destinations[match.kind](match.id)}
                >
                  {kindLabels[match.kind]} · {shortId(match.id)}
                </Link>
                {match.context === undefined ? null : (
                  <span className="a-caption a-quiet">
                    {' '}
                    — {humanState(match.context)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
