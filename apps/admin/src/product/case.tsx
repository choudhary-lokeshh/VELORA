'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ApiResult } from '@velora/api-client';

import type {
  CaseDetail,
  DecisionAction,
  DecisionReasonCode,
  EnforcementScope,
  SafetyCase,
} from '../api/contract';
import { failureMessage } from '../api/messages';
import { Dialog } from '../design/dialog';
import {
  Acknowledgement,
  Badge,
  Button,
  ButtonLink,
  Chip,
  EmptyState,
  ErrorMessage,
  ErrorState,
  Fact,
  Facts,
  Field,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Scroller,
  Select,
  Table,
  TextInput,
} from '../design/primitives';
import { useApi, useToast } from '../app/providers';
import {
  caseStateLabels,
  casePriorityLook,
  decisionActionLabels,
  enforcementReasonLabels,
  enforcementScopeLabels,
  formatDateTime,
  formatRemaining,
  humanState,
  queueLabels,
  shortId,
  targetTypeLabels,
} from './format';
import { useResource, useSingleFlight } from './resource';

/**
 * One case, and every operation the platform lets an operator take on it.
 *
 * The rules this screen is built to come from the surface document rather than
 * from taste. A decision carries the exact target and effect, a reason, the
 * evidence it rests on, and the version the operator was looking at — so two
 * moderators acting on the same case at the same time produce one decision and
 * one refusal rather than two enforcements. Nothing is applied optimistically:
 * the screen never claims a state the owning domain has not confirmed.
 *
 * What the screen does not do is interpret. It shows the reports as filed, the
 * evidence as recorded, and the decisions as made; it does not summarise them,
 * score them, or suggest an outcome. An operator's judgement is the product
 * here, and a console that pre-judged would be making the decision while
 * leaving the operator's name on it.
 */

export function CaseScreen({ caseId }: { readonly caseId: string }) {
  const api = useApi();
  const load = useCallback(async () => api.caseDetail(caseId), [api, caseId]);
  const detail = useResource<CaseDetail>(load);
  const record = detail.value;

  if (detail.error !== undefined && record === undefined) {
    return (
      <>
        <PageHeader eyebrow="Queues" title="Case" />
        <Panel>
          <PanelBody>
            <ErrorState
              body={detail.error}
              onRetry={detail.retryable ? detail.reload : undefined}
              testId="case-failed"
            />
          </PanelBody>
        </Panel>
      </>
    );
  }

  if (record === undefined && detail.missing) {
    return (
      <>
        <PageHeader eyebrow="Queues" title="Case" />
        <Panel>
          <PanelBody>
            <EmptyState
              actions={
                <ButtonLink href="/queues" tone="primary">
                  Back to the queues
                </ButtonLink>
              }
              body="There is no such case, or it is not one this console may read. Nothing was changed."
              icon="queue"
              testId="case-not-found"
              title="That case is not here"
            />
          </PanelBody>
        </Panel>
      </>
    );
  }

  if (record === undefined) {
    return (
      <>
        <PageHeader eyebrow="Queues" title="Case" />
        <Panel testId="case-loading">
          <PanelBody>
            <PanelSkeleton rows={5} />
          </PanelBody>
        </Panel>
      </>
    );
  }

  return <CaseDetailView detail={record} onChanged={detail.reload} />;
}

function CaseDetailView({
  detail,
  onChanged,
}: {
  readonly detail: CaseDetail;
  readonly onChanged: () => void;
}) {
  const record = detail.case;
  const priority = casePriorityLook(record.priority);
  const closed = record.state === 'closed';

  return (
    <>
      <PageHeader
        eyebrow="Queues"
        lede={`${queueLabels[record.queue] ?? humanState(record.queue)} · opened ${formatDateTime(record.openedAt)}`}
        title={`Case ${shortId(record.id)}`}
      />

      <div className="a-inline a-inline--tight">
        <Badge icon={priority.icon} testId="case-priority" tone={priority.tone}>
          {priority.label}
        </Badge>
        <Chip>{caseStateLabels[record.state] ?? humanState(record.state)}</Chip>
        <Chip icon="shield">
          {targetTypeLabels[record.targetType] ?? humanState(record.targetType)}
        </Chip>
        <span className="a-caption a-quiet a-mono" data-testid="case-id">
          {record.id}
        </span>
      </div>

      {detail.truncated ? (
        <Notice
          testId="case-truncated"
          title="Not everything is shown"
          tone="caution"
        >
          The platform returned a bounded slice of this case's reports and
          evidence. Decide on what is here only if it is enough; the record
          itself holds more.
        </Notice>
      ) : null}

      <div className="a-split">
        <div className="a-stack a-stack--5">
          <Reports detail={detail} />
          <Evidence detail={detail} />
          <Decisions detail={detail} />
        </div>

        <div className="a-stack a-stack--5">
          <Panel testId="case-facts">
            <PanelHead title="The record" />
            <PanelBody>
              <Facts>
                <Fact
                  term="Target"
                  testId="case-target"
                  value={
                    <span className="a-mono">{shortId(record.targetId)}</span>
                  }
                />
                <Fact
                  term="Policy version"
                  value={<span className="a-mono">{record.policyVersion}</span>}
                />
                <Fact
                  term="Version"
                  testId="case-version"
                  value={<span className="a-numeric">{record.version}</span>}
                />
                <Fact
                  term="Assignment"
                  testId="case-assignment"
                  value={
                    record.assigned
                      ? record.assignmentExpiresAt === undefined
                        ? 'Claimed'
                        : `Claimed, ${formatRemaining(record.assignmentExpiresAt)}`
                      : 'Unclaimed'
                  }
                />
              </Facts>
              <p className="a-caption a-quiet">
                The target is an opaque reference. This console publishes no
                name, handle, or content for the person or object behind it.
              </p>
            </PanelBody>
          </Panel>

          {closed ? (
            <Notice
              testId="case-closed"
              title="This case is closed"
              tone="quiet"
            >
              Nothing further can be decided on it. The decisions it already
              carries are listed beside this.
            </Notice>
          ) : (
            <CaseActions detail={detail} onChanged={onChanged} />
          )}
        </div>
      </div>
    </>
  );
}

/* =============================== Reports ============================= */

function Reports({ detail }: { readonly detail: CaseDetail }) {
  return (
    <Panel testId="case-reports">
      <PanelHead
        lede="What was filed. A report is somebody's account and never a finding."
        title="Reports"
      />
      {detail.reports.length === 0 ? (
        <PanelBody>
          <EmptyState
            body="This case was opened without a report behind it."
            icon="flag"
            testId="case-reports-empty"
            title="No reports"
          />
        </PanelBody>
      ) : (
        <PanelBody flush>
          <Scroller label="Reports">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Reason</th>
                  <th scope="col">Target</th>
                  <th scope="col">Source</th>
                  <th scope="col">State</th>
                  <th scope="col">Filed</th>
                </tr>
              </thead>
              <tbody>
                {detail.reports.map((report) => (
                  <tr data-testid={`report-${report.id}`} key={report.id}>
                    <td>
                      {enforcementReasonLabels[report.reasonCode] ??
                        humanState(report.reasonCode)}
                    </td>
                    <td>
                      {targetTypeLabels[report.targetType] ??
                        humanState(report.targetType)}
                    </td>
                    <td className="a-quiet">
                      {report.sourceSurface === undefined
                        ? '—'
                        : humanState(report.sourceSurface)}
                    </td>
                    <td>{humanState(report.state)}</td>
                    <td className="a-numeric a-quiet">
                      {formatDateTime(report.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
      )}
      {detail.reports.some((report) => report.detail !== undefined) ? (
        <PanelBody>
          <div className="a-stack a-stack--3">
            {detail.reports
              .filter((report) => report.detail !== undefined)
              .map((report) => (
                <blockquote className="a-quote" key={report.id}>
                  <p className="a-small a-wrap">{report.detail}</p>
                  <p className="a-caption a-quiet">
                    Filed {formatDateTime(report.createdAt)}
                  </p>
                </blockquote>
              ))}
          </div>
        </PanelBody>
      ) : null}
    </Panel>
  );
}

/* =============================== Evidence ============================ */

function Evidence({ detail }: { readonly detail: CaseDetail }) {
  return (
    <Panel testId="case-evidence">
      <PanelHead
        lede="What the platform recorded. A decision names the evidence it rests on."
        title="Evidence"
      />
      {detail.evidence.length === 0 ? (
        <PanelBody>
          <EmptyState
            body="Nothing has been recorded against this case yet."
            icon="shield"
            testId="case-evidence-empty"
            title="No evidence"
          />
        </PanelBody>
      ) : (
        <PanelBody flush>
          <Scroller label="Evidence">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Reference</th>
                  <th scope="col">State</th>
                  <th scope="col">Observed</th>
                  <th scope="col">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {detail.evidence.map((item) => (
                  <tr data-testid={`evidence-${item.id}`} key={item.id}>
                    <td>{humanState(item.kind)}</td>
                    <td className="a-quiet">
                      {item.referenceType === undefined
                        ? '—'
                        : `${humanState(item.referenceType)} ${
                            item.referenceId === undefined
                              ? ''
                              : shortId(item.referenceId)
                          }`}
                    </td>
                    <td>
                      {item.stateLabel === undefined
                        ? '—'
                        : humanState(item.stateLabel)}
                    </td>
                    <td className="a-numeric a-quiet">
                      {item.observedAt === undefined
                        ? '—'
                        : formatDateTime(item.observedAt)}
                    </td>
                    <td className="a-numeric a-quiet">
                      {formatDateTime(item.recordedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
      )}
    </Panel>
  );
}

/* ============================== Decisions ============================ */

function Decisions({ detail }: { readonly detail: CaseDetail }) {
  return (
    <Panel testId="case-decisions">
      <PanelHead
        lede="Every decision made on this case, including the ones a later decision replaced."
        title="Decisions"
      />
      {detail.decisions.length === 0 ? (
        <PanelBody>
          <EmptyState
            body="Nothing has been decided on this case."
            icon="scale"
            testId="case-decisions-empty"
            title="No decisions"
          />
        </PanelBody>
      ) : (
        <PanelBody flush>
          <Scroller label="Decisions">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Effect</th>
                  <th scope="col">Decided</th>
                </tr>
              </thead>
              <tbody>
                {detail.decisions.map((decision) => (
                  <tr data-testid={`decision-${decision.id}`} key={decision.id}>
                    <td>
                      <span className="a-inline a-inline--tight">
                        {decisionActionLabels[decision.action] ??
                          humanState(decision.action)}
                        {decision.supersedesId === undefined ? null : (
                          <Badge icon="undo" tone="neutral">
                            Replaces one
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td>
                      {enforcementReasonLabels[decision.reasonCode] ??
                        humanState(decision.reasonCode)}
                    </td>
                    <td className="a-quiet">
                      {decision.scope === undefined
                        ? '—'
                        : (enforcementScopeLabels[decision.scope] ??
                          humanState(decision.scope))}
                    </td>
                    <td className="a-quiet">
                      {decision.priorState === undefined ||
                      decision.resultingState === undefined
                        ? '—'
                        : `${humanState(decision.priorState)} → ${humanState(decision.resultingState)}`}
                    </td>
                    <td className="a-numeric a-quiet">
                      {formatDateTime(decision.decidedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
      )}
    </Panel>
  );
}

/* =============================== Actions ============================= */

function CaseActions({
  detail,
  onChanged,
}: {
  readonly detail: CaseDetail;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [deciding, setDeciding] = useState(false);
  const record = detail.case;

  const act = (
    work: () => Promise<ApiResult<unknown>>,
    confirmation: string,
  ) => {
    run(async () => {
      const failure = failureMessage(await work(), {
        conflict:
          'This case changed since the page read it. Reload and look at the current state before acting.',
      });
      setMessage(failure);
      if (failure === undefined) toast.show(confirmation, 'positive');
      onChanged();
    });
  };

  return (
    <Panel testId="case-actions">
      <PanelHead
        lede="Each of these is recorded against this case with the operator, the reason, and the version it acted on."
        title="Operations"
      />
      <PanelBody>
        {message === undefined ? null : (
          <ErrorMessage testId="case-action-error">{message}</ErrorMessage>
        )}

        {record.assigned ? (
          <p className="a-small a-muted" data-testid="case-already-claimed">
            This case is claimed. A claim expires on its own, so somebody else
            picking it up later is the platform working rather than a conflict.
          </p>
        ) : (
          <Button
            block
            busy={busy}
            data-testid="case-claim"
            icon="check"
            onClick={() => {
              act(async () => api.claimCase(record.id), 'Case claimed.');
            }}
          >
            Claim this case
          </Button>
        )}

        <Triage busy={busy} onSubmit={act} record={record} />

        <Button
          block
          data-testid="case-decide"
          disabled={busy}
          onClick={() => {
            setDeciding(true);
          }}
          tone="primary"
        >
          Record a decision
        </Button>
      </PanelBody>

      {deciding ? (
        <DecisionDialog
          detail={detail}
          onClose={() => {
            setDeciding(false);
          }}
          onDecided={() => {
            setDeciding(false);
            onChanged();
          }}
        />
      ) : null}
    </Panel>
  );
}

/**
 * Triage: a priority and a position in the workflow.
 *
 * Deliberately not a decision. Moving a case to "investigating" enforces
 * nothing and is reversible, so it takes no confirmation; recording a decision
 * enforces something and is not, so it does.
 */
function Triage({
  busy,
  onSubmit,
  record,
}: {
  readonly busy: boolean;
  readonly onSubmit: (
    work: () => Promise<ApiResult<unknown>>,
    confirmation: string,
  ) => void;
  readonly record: SafetyCase;
}) {
  const api = useApi();
  const [priority, setPriority] = useState(record.priority);
  const [state, setState] = useState<'triaged' | 'investigating'>(
    record.state === 'investigating' ? 'investigating' : 'triaged',
  );

  useEffect(() => {
    setPriority(record.priority);
  }, [record.priority]);

  return (
    <div className="a-stack a-stack--3">
      <Field hint="Where this case sits and how urgent it is." label="Triage">
        {(control) => (
          <Select
            {...control}
            data-testid="case-priority-select"
            onChange={(event) => {
              setPriority(event.target.value as typeof priority);
            }}
            value={priority}
          >
            <option value="untriaged">Untriaged</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        )}
      </Field>
      <Field label="Workflow state">
        {(control) => (
          <Select
            {...control}
            data-testid="case-state-select"
            onChange={(event) => {
              setState(
                event.target.value === 'investigating'
                  ? 'investigating'
                  : 'triaged',
              );
            }}
            value={state}
          >
            <option value="triaged">Triaged</option>
            <option value="investigating">Investigating</option>
          </Select>
        )}
      </Field>
      <Button
        busy={busy}
        data-testid="case-triage"
        onClick={() => {
          onSubmit(
            async () => api.triageCase({ caseId: record.id, priority, state }),
            'Triage recorded.',
          );
        }}
      >
        Save triage
      </Button>
    </div>
  );
}

/**
 * Recording a decision.
 *
 * The one dialog on this surface that applies enforcement, so it carries every
 * field the contract requires rather than defaulting any of them: the action,
 * the reason, the evidence it rests on, and the version the operator was
 * looking at. The version is what makes two moderators deciding at once produce
 * one decision and one refusal.
 *
 * The scope and the expiry appear only for the actions that take them, because
 * a form that asked for an expiry on "no action" would be asking an operator to
 * think about something the platform will ignore.
 */
function DecisionDialog({
  detail,
  onClose,
  onDecided,
}: {
  readonly detail: CaseDetail;
  readonly onClose: () => void;
  readonly onDecided: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [action, setAction] = useState<DecisionAction>('no_action');
  /**
   * Deliberately unset, like the scope below it.
   *
   * A preselected reason is the trap this form is most likely to spring: an
   * operator changes the action to a hold, never touches the field, and the
   * record keeps "no violation found" against an enforcement. The console will
   * not pair reasons with actions itself — which reason fits which action is
   * policy, and policy is not written here — so it asks for the reason instead
   * and refuses to submit without one.
   */
  const [reasonCode, setReasonCode] = useState<DecisionReasonCode | ''>('');
  const [scope, setScope] = useState<EnforcementScope | ''>('');
  const [expiresAt, setExpiresAt] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [evidenceIds, setEvidenceIds] = useState<readonly string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const enforcing = action !== 'no_action' && action !== 'escalate';
  const needsExpiry = action === 'temporary_hold';
  const needsConversation = scope === 'conversation_closure';
  const blocked =
    !acknowledged ||
    reasonCode === '' ||
    (enforcing && scope === '') ||
    (needsExpiry && expiresAt.trim().length === 0) ||
    (needsConversation && conversationId.trim().length === 0);

  return (
    <Dialog
      onClose={onClose}
      testId="decision-dialog"
      title="Record a decision"
      wide
    >
      <p className="a-small a-muted">
        This is written to the case with your session, the reason, the evidence
        you name, and the version below. It is not reversible from here; a later
        decision replaces it and both stay on the record.
      </p>

      {message === undefined ? null : (
        <ErrorMessage testId="decision-error">{message}</ErrorMessage>
      )}

      <div className="a-stack a-stack--4">
        <Field label="Action">
          {(control) => (
            <Select
              {...control}
              data-testid="decision-action"
              onChange={(event) => {
                setAction(event.target.value as DecisionAction);
              }}
              value={action}
            >
              {Object.entries(decisionActionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Reason">
          {(control) => (
            <Select
              {...control}
              data-testid="decision-reason"
              onChange={(event) => {
                setReasonCode(event.target.value as DecisionReasonCode | '');
              }}
              value={reasonCode}
            >
              <option value="">Choose a reason</option>
              {Object.entries(enforcementReasonLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {enforcing ? (
          <Field
            hint="What the enforcement acts on. The owning domain applies it and may still refuse."
            label="Scope"
          >
            {(control) => (
              <Select
                {...control}
                data-testid="decision-scope"
                onChange={(event) => {
                  setScope(event.target.value as EnforcementScope | '');
                }}
                value={scope}
              >
                <option value="">Choose a scope</option>
                {Object.entries(enforcementScopeLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </Select>
            )}
          </Field>
        ) : null}

        {needsConversation ? (
          <Field
            hint="The conversation this closes. Paste the identifier you already hold; there is no search."
            label="Conversation"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="decision-conversation"
                onChange={(event) => {
                  setConversationId(event.target.value);
                }}
                spellCheck={false}
                value={conversationId}
              />
            )}
          </Field>
        ) : null}

        {needsExpiry ? (
          <Field
            hint="When the hold lifts on its own. A hold with no end is a suspension by another name."
            label="Expires"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="decision-expires"
                onChange={(event) => {
                  setExpiresAt(event.target.value);
                }}
                type="datetime-local"
                value={expiresAt}
              />
            )}
          </Field>
        ) : null}

        <fieldset className="a-fieldset">
          <legend className="a-field__label">Evidence</legend>
          <p className="a-field__hint">
            What this decision rests on. Naming none is allowed and is itself a
            fact the record keeps.
          </p>
          {detail.evidence.length === 0 ? (
            <p className="a-small a-quiet">
              Nothing is recorded against this case to name.
            </p>
          ) : (
            <div className="a-stack a-stack--2">
              {detail.evidence.map((item) => (
                <Acknowledgement
                  checked={evidenceIds.includes(item.id)}
                  key={item.id}
                  onChange={(next) => {
                    setEvidenceIds((current) =>
                      next
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    );
                  }}
                  testId={`decision-evidence-${item.id}`}
                >
                  {humanState(item.kind)}{' '}
                  <span className="a-quiet">
                    · recorded {formatDateTime(item.recordedAt)}
                  </span>
                </Acknowledgement>
              ))}
            </div>
          )}
        </fieldset>

        <Acknowledgement
          checked={acknowledged}
          onChange={setAcknowledged}
          testId="decision-acknowledge"
        >
          I am recording this against case {shortId(detail.case.id)} at version{' '}
          {detail.case.version}, and I understand it is applied by the owning
          domain and kept on the record.
        </Acknowledgement>
      </div>

      <div className="a-dialog__actions">
        <Button disabled={busy} onClick={onClose} tone="ghost">
          Cancel
        </Button>
        <Button
          busy={busy}
          data-testid="decision-submit"
          disabled={blocked}
          tone={enforcing ? 'danger' : 'primary'}
          onClick={() => {
            run(async () => {
              const result = await api.decideCase({
                action,
                caseId: detail.case.id,
                evidenceIds: [...evidenceIds],
                expectedVersion: detail.case.version,
                ...(needsExpiry && expiresAt.length > 0
                  ? { expiresAt: new Date(expiresAt).toISOString() }
                  : {}),
                reasonCode: reasonCode as DecisionReasonCode,
                ...(enforcing && scope !== '' ? { scope } : {}),
                ...(needsConversation
                  ? { targetConversationId: conversationId.trim() }
                  : {}),
              });
              const failure = failureMessage(result, {
                conflict:
                  'This case changed since the page read it. Nothing was decided. Reload and look at the current state.',
              });
              setMessage(failure);
              if (failure === undefined) {
                toast.show('Decision recorded.', 'positive');
                onDecided();
              }
            });
          }}
        >
          Record the decision
        </Button>
      </div>
    </Dialog>
  );
}
