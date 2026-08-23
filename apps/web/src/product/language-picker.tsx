'use client';

import { useState } from 'react';

import { languagePattern, maximumProfileLanguages } from '@velora/validation';

import { Icon } from '../design/icons';
import { Button, Field, TextInput } from '../design/primitives';
import { languageName } from './locale';

/**
 * The languages somebody speaks, as a set rather than as a comma-separated
 * string.
 *
 * The contract stores BCP 47 primary subtags, which is the right thing to store
 * and the wrong thing to ask for in a text box: a person who typed "Spanish"
 * into a comma-separated field got a validation failure with no way to see what
 * went wrong. Here a code is echoed back as its language name the moment it is
 * valid, so the confirmation happens before the save rather than after it.
 *
 * There is no list of languages to choose from. `Intl.DisplayNames` names a code
 * without anybody shipping a catalogue, and a curated list would quietly become
 * a statement about which languages VELORA supports.
 */
export function LanguagePicker({
  error,
  onChange,
  value,
}: {
  readonly error?: string | undefined;
  readonly onChange: (next: readonly string[]) => void;
  readonly value: readonly string[];
}) {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);

  const normalized = draft.trim().toLowerCase();
  const wellFormed = languagePattern.test(normalized);
  const full = value.length >= maximumProfileLanguages;

  const add = () => {
    if (!wellFormed) {
      setMessage('Use a two or three letter code, such as en or spa.');
      return;
    }
    if (value.includes(normalized)) {
      setMessage('That one is already on your profile.');
      return;
    }
    if (full) {
      setMessage(
        `You can list up to ${String(maximumProfileLanguages)} languages.`,
      );
      return;
    }
    setMessage(undefined);
    setDraft('');
    onChange([...value, normalized]);
  };

  return (
    <div className="v-stack v-stack--3">
      <Field
        error={error ?? message}
        hint={
          wellFormed && !value.includes(normalized)
            ? `Add ${languageName(normalized)}.`
            : `Language codes, up to ${String(maximumProfileLanguages)}. Discovery uses the ones you and somebody else share.`
        }
        label="Languages you speak"
      >
        {(control) => (
          <div className="v-inline v-inline--tight v-inline--nowrap">
            <TextInput
              {...control}
              autoCapitalize="none"
              autoComplete="off"
              data-testid="language-input"
              disabled={full}
              maxLength={3}
              name="language"
              onChange={(event) => {
                setDraft(event.target.value.toLowerCase());
                setMessage(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                // Adding a chip is not submitting the form around it.
                event.preventDefault();
                add();
              }}
              placeholder="en"
              value={draft}
            />
            <Button
              data-testid="language-add"
              disabled={full}
              icon="plus"
              onClick={add}
            >
              Add
            </Button>
          </div>
        )}
      </Field>

      {value.length === 0 ? null : (
        <ul className="v-chip-set" data-testid="language-list">
          {value.map((code) => (
            <li key={code}>
              <span className="v-chip">
                {languageName(code)}
                <button
                  aria-label={`Remove ${languageName(code)}`}
                  data-testid={`language-remove-${code}`}
                  onClick={() => {
                    setMessage(undefined);
                    onChange(value.filter((entry) => entry !== code));
                  }}
                  style={{ color: 'inherit', display: 'flex' }}
                  type="button"
                >
                  <Icon name="x" size="sm" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
