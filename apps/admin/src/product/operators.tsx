'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { OperatorGrantList, OperatorRoleBody } from '../api/contract';
import { ConfirmDialog } from '../design/dialog';
import {
  AreaNav,
  Badge,
  BlockedState,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Reference,
  Scroller,
  Select,
  Table,
  TextArea,
  TextInput,
} from '../design/primitives';
import { platformAreas } from '../app/navigation';
import { useApi, useOperator, useToast } from '../app/providers';
import { formatDateTime, shortId } from './format';
import { useResource, useSingleFlight } from './resource';

/**
 * Who may operate this platform, and what each of them may do.
 *
 * The screen that grants capabilities is the one whose own capability is
 * unbounded: an operator who can hand out roles can hand themselves every other
 * one. That is why `operators.manage` is its own capability held by one role,
 * why every grant carries a reason, and why a revoked grant keeps its row —
 * knowing who held what during the window an incident happened in is the whole
 * point of an access record.
 *
 * The catalogue of what each role can do is published by the platform and shown
 * beside the form. An operator granting a role should be able to read what they
 * are handing over without opening a document, and a console that hard-coded
 * that list would eventually describe a role the server no longer has.
 */
export function PlatformOperators() {
  const api = useApi();
  const operator = useOperator();
  const pathname = usePathname();
  const toast = useToast();
  const load = useCallback(async () => api.operatorGrants(), [api]);
  const grants = useResource<OperatorGrantList>(load);
  const { busy, run } = useSingleFlight();

  const [subject, setSubject] = useState('');
  const [role, setRole] = useState('readonly');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{
    readonly reason?: string;
    readonly subject?: string;
  }>({});
  const [confirming, setConfirming] = useState<OperatorRoleBody | undefined>(
    undefined,
  );

  const mayManage = operator.may('operators.manage');

  const review = () => {
    const trimmedSubject = subject.trim();
    const trimmedReason = reason.trim();
    const next: { reason?: string; subject?: string } = {};
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        trimmedSubject.toLowerCase(),
      )
    ) {
      next.subject = 'An operator is named by their account identifier.';
    }
    if (trimmedReason.length < 8) {
      next.reason = 'Say why, in at least eight characters.';
    }
    setErrors(next);
    if (next.reason !== undefined || next.subject !== undefined) return;
    setConfirming({
      reason: trimmedReason,
      ...(role === 'none'
        ? {}
        : { role: role as NonNullable<OperatorRoleBody['role']> }),
      subjectReference: trimmedSubject.toLowerCase(),
    });
  };

  const commit = (body: OperatorRoleBody) => {
    run(async () => {
      const result = await api.setOperatorRole(body);
      setConfirming(undefined);
      if (result.kind !== 'ok') {
        toast.show('The role was not changed.', 'critical');
        return;
      }
      grants.reload();
      operator.refresh();
      setSubject('');
      setReason('');
      toast.show(
        result.value.outcome === 'granted'
          ? `Role granted: ${result.value.grant?.role ?? ''}`
          : result.value.outcome === 'revoked'
            ? 'Operator role revoked'
            : 'Nothing to change — that operator already held no role.',
        result.value.outcome === 'unchanged' ? 'neutral' : 'positive',
      );
    });
  };

  return (
    <>
      <PageHeader
        lede="Who holds which role. Every route on this console authorizes against a capability on the server, whatever this screen draws."
        title="Platform"
      />
      <AreaNav
        areas={platformAreas}
        current={pathname}
        label="Platform areas"
        testId="operators-areas"
      />

      {operator.source === 'bootstrap' ? (
        <Notice testId="operators-bootstrap" tone="caution">
          This machine treats an operator with no grant as a super
          administrator. That is a local and test convenience; staging and
          production refuse it at startup, where an operator with no grant may
          do nothing at all.
        </Notice>
      ) : null}

      {operator.known && !mayManage ? (
        <Panel>
          <PanelBody>
            <BlockedState
              testId="operators-blocked"
              title="Not your capability"
            >
              Granting and revoking operator roles needs{' '}
              <code>operators.manage</code>, which is deliberately held by one
              role: whoever holds it can grant themselves everything else.
            </BlockedState>
          </PanelBody>
        </Panel>
      ) : grants.error !== undefined && grants.value === undefined ? (
        <Panel>
          <PanelBody>
            <ErrorState
              body={grants.error}
              onRetry={grants.retryable ? grants.reload : undefined}
              testId="operators-failed"
            />
          </PanelBody>
        </Panel>
      ) : grants.value === undefined ? (
        <PanelSkeleton />
      ) : (
        <>
          <Panel testId="operators-grant">
            <PanelHead title="Grant or revoke a role" />
            <PanelBody>
              <Field
                error={errors.subject}
                hint="The operator's own account identifier, which they can read on Access."
                label="Operator"
              >
                {(control) => (
                  <TextInput
                    {...control}
                    data-testid="operator-subject"
                    onChange={(event) => {
                      setSubject(event.target.value);
                    }}
                    value={subject}
                  />
                )}
              </Field>
              <Field
                hint="Choose “No role” to revoke whatever they currently hold."
                label="Role"
              >
                {(control) => (
                  <Select
                    {...control}
                    data-testid="operator-role"
                    onChange={(event) => {
                      setRole(event.target.value);
                    }}
                    value={role}
                  >
                    {grants.value?.catalogue.map((entry) => (
                      <option key={entry.role} value={entry.role}>
                        {entry.role}
                      </option>
                    ))}
                    <option value="none">No role (revoke)</option>
                  </Select>
                )}
              </Field>
              <Field
                error={errors.reason}
                hint="Written to the operator audit. The next person reads this."
                label="Reason"
              >
                {(control) => (
                  <TextArea
                    {...control}
                    data-testid="operator-reason"
                    onChange={(event) => {
                      setReason(event.target.value);
                    }}
                    rows={3}
                    value={reason}
                  />
                )}
              </Field>
              <div className="a-toolbar">
                <Button
                  data-testid="operator-submit"
                  onClick={review}
                  tone="primary"
                >
                  Review
                </Button>
              </div>
            </PanelBody>
          </Panel>

          <Panel testId="operators-catalogue">
            <PanelHead title="What each role can do" />
            <PanelBody flush>
              <Scroller label="Role catalogue">
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col">Capabilities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grants.value.catalogue.map((entry) => (
                      <tr key={entry.role}>
                        <th scope="row">{entry.role}</th>
                        <td className="a-caption a-quiet">
                          {entry.capabilities.join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Scroller>
            </PanelBody>
          </Panel>

          <Panel testId="operators-list">
            <PanelHead title="Grants" />
            {grants.value.grants.length === 0 ? (
              <PanelBody>
                <EmptyState
                  body="Nobody has been granted a role on this platform yet."
                  testId="operators-empty"
                  title="No grants"
                />
              </PanelBody>
            ) : (
              <PanelBody flush>
                <Scroller label="Operator grants">
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Operator</th>
                        <th scope="col">Role</th>
                        <th scope="col">Granted</th>
                        <th scope="col">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grants.value.grants.map((grant) => (
                        <tr data-testid={`grant-${grant.id}`} key={grant.id}>
                          <th scope="row">
                            <Reference
                              short={shortId(grant.subjectReference)}
                              value={grant.subjectReference}
                            />
                          </th>
                          <td>{grant.role}</td>
                          <td className="a-numeric">
                            {formatDateTime(grant.grantedAt)}
                          </td>
                          <td>
                            <Badge
                              tone={
                                grant.revokedAt === undefined
                                  ? 'positive'
                                  : 'neutral'
                              }
                            >
                              {grant.revokedAt === undefined
                                ? 'Live'
                                : 'Revoked'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Scroller>
              </PanelBody>
            )}
          </Panel>
        </>
      )}

      {confirming === undefined ? null : (
        <ConfirmDialog
          busy={busy}
          confirmLabel={confirming.role === undefined ? 'Revoke' : 'Grant'}
          confirmTone={confirming.role === undefined ? 'danger' : 'primary'}
          onCancel={() => {
            setConfirming(undefined);
          }}
          onConfirm={() => {
            commit(confirming);
          }}
          testId="operator-confirm"
          title={
            confirming.role === undefined
              ? 'Revoke this operator’s role'
              : `Grant ${confirming.role}`
          }
        >
          <p>
            Operator {shortId(confirming.subjectReference)}
            {confirming.role === undefined
              ? ' will hold no capabilities at all.'
              : ` will hold every capability of ${confirming.role}, replacing whatever they hold now.`}
          </p>
          <p>This is written to the operator audit with your reason.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
