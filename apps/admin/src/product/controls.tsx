'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { ControlList, OperationalControl } from '../api/contract';
import { ConfirmDialog } from '../design/dialog';
import {
  AreaNav,
  Badge,
  BlockedState,
  Button,
  ErrorState,
  Field,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  TextArea,
} from '../design/primitives';
import { platformAreas } from '../app/navigation';
import { useApi, useOperator, useToast } from '../app/providers';
import { formatDateTime } from './format';
import { useResource, useSingleFlight } from './resource';

/**
 * The switches the platform actually obeys.
 *
 * Every control on this screen is read by server code on the path it governs.
 * There is no client-only flag here and there could not be: turning one off in
 * this console changes what the API does, and turning it off in the API without
 * this console would change what this console shows. That is the whole
 * difference between a control plane and a settings page.
 *
 * Three things this screen is careful about.
 *
 * **It tells the truth about propagation.** A control is cached in each API
 * process for a few seconds, so a change is not instant, and the bound is
 * printed beside the switch rather than left for an operator to discover by
 * pressing it twice.
 *
 * **It requires a reason and a confirmation.** Pausing live matchmaking stops
 * the product for everybody who was about to use it. The reason is not
 * decoration: it is written to the operator audit and is what the next person
 * reads when they ask why the platform was paused at 3am.
 *
 * **It handles losing a race.** Two operators on this screen during an incident
 * is the normal case. A write states the version it read; if somebody else got
 * there first the platform refuses and answers with what actually stands, and
 * this screen says so and shows the new value rather than pretending.
 */
export function PlatformControls() {
  const api = useApi();
  const operator = useOperator();
  const pathname = usePathname();
  const toast = useToast();
  const load = useCallback(async () => api.controls(), [api]);
  const controls = useResource<ControlList>(load);
  const { busy, run } = useSingleFlight();
  const [pending, setPending] = useState<OperationalControl | undefined>(
    undefined,
  );
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  const mayWrite = operator.may('config.write');

  const apply = (control: OperationalControl) => {
    const trimmed = reason.trim();
    if (trimmed.length < 8) {
      setReasonError('Say why, in at least eight characters.');
      return;
    }
    run(async () => {
      const result = await api.setControl({
        enabled: !control.enabled,
        expectedVersion: control.version,
        key: control.key,
        reason: trimmed,
      });
      setPending(undefined);
      setReason('');
      setReasonError(undefined);
      if (result.kind !== 'ok') {
        toast.show('The control was not changed.', 'critical');
        return;
      }
      controls.reload();
      if (result.value.outcome === 'conflict') {
        // Not an error, and not a success. Somebody else moved it while this
        // operator was deciding, and the honest report is what now stands.
        toast.show(
          `Another operator changed ${result.value.control.key} first. It is now ${
            result.value.control.enabled ? 'on' : 'off'
          }.`,
          'critical',
        );
        return;
      }
      toast.show(
        `${result.value.control.key} is now ${
          result.value.control.enabled ? 'on' : 'off'
        }. It takes effect everywhere within ${String(
          Math.round(result.value.propagationMilliseconds / 1000),
        )}s.`,
        'positive',
      );
    });
  };

  return (
    <>
      <PageHeader
        lede="Operational switches the server obeys. Each one is read by the code it governs, so switching it here changes what the platform does."
        title="Platform"
      />
      <AreaNav
        areas={platformAreas}
        current={pathname}
        label="Platform areas"
        testId="controls-areas"
      />

      {operator.known && !operator.may('config.read') ? (
        <Panel>
          <PanelBody>
            <BlockedState testId="controls-blocked" title="Not your capability">
              Reading the control plane needs the <code>config.read</code>{' '}
              capability. An operator holding <code>operators.manage</code> can
              grant a role that has it.
            </BlockedState>
          </PanelBody>
        </Panel>
      ) : controls.error !== undefined && controls.value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={controls.error}
              onRetry={controls.retryable ? controls.reload : undefined}
              testId="controls-failed"
            />
          </PanelBody>
        </Panel>
      ) : controls.value === undefined ? (
        <PanelSkeleton />
      ) : (
        <>
          <Notice testId="controls-propagation" tone="info">
            A change reaches every API process within{' '}
            {String(Math.round(controls.value.propagationMilliseconds / 1000))}{' '}
            seconds. Nothing here is instant, and nothing here claims to be.
          </Notice>

          {controls.value.controls.map((control) => (
            <Panel key={control.key} testId={`control-${control.key}`}>
              <PanelHead
                actions={
                  <Badge tone={control.enabled ? 'positive' : 'critical'}>
                    {control.enabled ? 'On' : 'Paused'}
                  </Badge>
                }
                title={control.key}
              />
              <PanelBody>
                <p className="a-small a-muted">{control.summary}</p>
                <p className="a-caption a-quiet">
                  {control.updatedAt === undefined
                    ? 'Never changed. This is the value the platform shipped with.'
                    : `Changed ${formatDateTime(control.updatedAt)} by ${
                        control.changedBy ?? 'an operator'
                      }${control.reason === undefined ? '' : ` — ${control.reason}`}`}
                </p>
                {mayWrite ? (
                  <div className="a-toolbar">
                    <Button
                      data-testid={`control-${control.key}-toggle`}
                      onClick={() => {
                        setPending(control);
                        setReason('');
                        setReasonError(undefined);
                      }}
                      tone={control.enabled ? 'danger' : 'primary'}
                    >
                      {control.enabled ? 'Pause' : 'Resume'}
                    </Button>
                  </div>
                ) : null}
              </PanelBody>
            </Panel>
          ))}
        </>
      )}

      {pending === undefined ? null : (
        <ConfirmDialog
          busy={busy}
          confirmLabel={pending.enabled ? 'Pause it' : 'Resume it'}
          confirmTone={pending.enabled ? 'danger' : 'primary'}
          onCancel={() => {
            setPending(undefined);
          }}
          onConfirm={() => {
            apply(pending);
          }}
          testId="control-confirm"
          title={`${pending.enabled ? 'Pause' : 'Resume'} ${pending.key}`}
        >
          <p>{pending.summary}</p>
          <p>
            This changes what the platform does for everybody, and the reason
            below is written to the operator audit.
          </p>
          <Field
            error={reasonError}
            hint="At least eight characters. The next operator reads this."
            label="Reason"
          >
            {(control) => (
              <TextArea
                {...control}
                data-testid="control-reason"
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(undefined);
                }}
                rows={3}
                value={reason}
              />
            )}
          </Field>
        </ConfirmDialog>
      )}
    </>
  );
}
