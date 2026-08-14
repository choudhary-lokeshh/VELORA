import { z } from 'zod';

import { idempotencyKeySchema } from './product.js';

/**
 * Trust and safety contract.
 *
 * Two rules shape every shape here.
 *
 * A block is never disclosed. Nothing in this contract tells anybody that they
 * have been blocked, by whom, or when; a blocked person's experience is that a
 * candidate is not there and a message cannot be sent, which is exactly what a
 * peer sees when somebody simply is not available.
 *
 * A report is evidence, not a record a consumer may browse. The reporter learns
 * that their report exists and what state it is in. The reporter's identity, the
 * narrative they wrote, and every internal rationale are absent from this
 * contract entirely — there is no field for them, so no response can carry one.
 */

/**
 * What a reporter may say is wrong.
 *
 * **Provisional.** The approved risk taxonomy is
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. This is a reporter-facing
 * selection, and it is deliberately not the vocabulary an enforcement decision
 * records: a report is an allegation, and only a review makes it anything more.
 */
export const reportReasonSchema = z.enum([
  'underage_concern',
  'harassment',
  'sexual_content_violation',
  'impersonation',
  'spam_or_scam',
  'other',
]);

/** Report lifecycle, as its own reporter may see it. */
export const reportStateSchema = z.enum([
  'received',
  'under_review',
  'actioned',
  'dismissed',
]);

export const blockRequestSchema = z.object({ targetId: z.uuid() }).strict();

export const blockSchema = z
  .object({
    blockedId: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const blockListResponseSchema = z
  .object({
    blocks: z.array(blockSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

/** Longest reporter narrative accepted. */
export const maximumReportDetailCharacters = 2_000;

export const createReportRequestSchema = z
  .object({
    /** Makes submission retry-safe. Scoped by the server to the reporter. */
    clientReportId: idempotencyKeySchema,
    /** Opaque conversation reference, when the report comes from one. */
    conversationId: z.uuid().optional(),
    detail: z.string().min(1).max(maximumReportDetailCharacters).optional(),
    /** Opaque message reference. Only meaningful with a conversation. */
    messageId: z.uuid().optional(),
    reasonCode: reportReasonSchema,
    subjectId: z.uuid(),
  })
  .strict()
  .refine(
    (value) =>
      value.messageId === undefined || value.conversationId !== undefined,
    'Evidence about a message must name the conversation it is in',
  );

/**
 * A report as its own reporter may see it.
 *
 * There is no reporter field, because the only caller who can retrieve this is
 * the reporter. There is no detail field: echoing stored evidence back over the
 * API would turn an evidence record into a readable store, and the reporter
 * already knows what they wrote. There is no moderator, no case, and no
 * rationale.
 */
export const reportSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    reasonCode: reportReasonSchema,
    state: reportStateSchema,
    subjectId: z.uuid(),
  })
  .strict();

export const reportListResponseSchema = z
  .object({
    nextCursor: z.string().optional(),
    reports: z.array(reportSchema),
  })
  .strict();

export type Block = z.infer<typeof blockSchema>;
export type Report = z.infer<typeof reportSchema>;
