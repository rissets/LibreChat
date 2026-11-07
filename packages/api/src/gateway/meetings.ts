import { z } from 'zod';
import {
  meetingWorkspaceInputSchema,
  meetingChatMessageInputSchema,
  meetingAudioInputSchema,
  meetingCaptureInputSchema,
  meetingFinalizationInputSchema,
  meetingCorrectionInputSchema,
  meetingReviewInputSchema,
  meetingAssistantInputSchema,
  meetingVoiceInputSchema,
  meetingVoiceAudioSchema,
  meetingVoiceCancelSchema,
  meetingShareInputSchema,
  meetingShareRevokeInputSchema,
  meetingSpeechInputSchema,
  meetingPlaybackInputSchema,
} from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { GatewayDeps } from './config';
import { identitySessions, machineToken } from './index';

interface MeetingUser {
  provider?: string;
  openidId?: string;
  openidIssuer?: string;
  governanceDisabled?: boolean;
  tenantId?: string;
  identitySessionId?: string;
}
class MeetingError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
const input = z
  .object({
    title: z.string().trim().min(1).max(200),
    meeting_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    agenda: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();

const writeOperations: Partial<
  Record<string, { schema: z.ZodType; status: number; timeout?: number }>
> = {
  create: { schema: input, status: 201 },
  saveWorkspace: { schema: meetingWorkspaceInputSchema, status: 200 },
  openChat: { schema: z.object({}).strict(), status: 200 },
  deleteChat: { schema: z.object({ chat_id: z.string().uuid() }).strict(), status: 200 },
  chatMessage: { schema: meetingChatMessageInputSchema, status: 200, timeout: 210000 },
  capture: { schema: meetingCaptureInputSchema, status: 200 },
  audio: { schema: meetingAudioInputSchema, status: 200, timeout: 1300000 },
  ask: { schema: meetingAssistantInputSchema, status: 200, timeout: 210000 },
  synthesize: { schema: meetingSpeechInputSchema, status: 200, timeout: 230000 },
  playback: { schema: meetingPlaybackInputSchema, status: 200 },
  finalize: { schema: meetingFinalizationInputSchema, status: 202 },
  finalizationRetry: { schema: meetingFinalizationInputSchema, status: 202 },
  voiceBegin: { schema: meetingVoiceInputSchema, status: 201 },
  voiceAudio: { schema: meetingVoiceAudioSchema, status: 202 },
  voiceCancel: { schema: meetingVoiceCancelSchema, status: 200 },
  finalCorrections: { schema: meetingCorrectionInputSchema, status: 201 },
  finalReview: { schema: meetingReviewInputSchema, status: 201 },
  share: { schema: meetingShareInputSchema, status: 201 },
  revokeShare: { schema: meetingShareRevokeInputSchema, status: 200 },
  confirmDelivery: {
    schema: z.object({ receipt: z.string().min(1).max(20000) }).strict(),
    status: 200,
  },
};

/** Requires the host's JWT middleware, which verifies the active identity session on every request. */
type MeetingHandler = (req: Request, res: Response) => Promise<void>;
export function createMeetingGateway(deps: {
  config: () => GatewayDeps | null;
  /** Adapt only after CP delivery and identity checks have succeeded. */
  respond?: (value: unknown, req: Request, res: Response) => void | Promise<void>;
  failure?: (status: number, code: string, req: Request, res: Response) => void;
}): {
  workspace: MeetingHandler;
  saveWorkspace: MeetingHandler;
  nativeContext: MeetingHandler;
  chats: MeetingHandler;
  chat: MeetingHandler;
  openChat: MeetingHandler;
  deleteChat: MeetingHandler;
  chatMessage: MeetingHandler;
  access: MeetingHandler;
  list: MeetingHandler;
  create: MeetingHandler;
  detail: MeetingHandler;
  capture: MeetingHandler;
  audio: MeetingHandler;
  transcript: MeetingHandler;
  lifecycle: MeetingHandler;
  finalization: MeetingHandler;
  finalize: MeetingHandler;
  finalizationRetry: MeetingHandler;
  finalCorrections: MeetingHandler;
  finalReview: MeetingHandler;
  finalEvidence: MeetingHandler;
  assistant: MeetingHandler;
  ask: MeetingHandler;
  evidence: MeetingHandler;
  voice: MeetingHandler;
  voiceBegin: MeetingHandler;
  voiceAudio: MeetingHandler;
  voiceCancel: MeetingHandler;
  recipients: MeetingHandler;
  shares: MeetingHandler;
  share: MeetingHandler;
  revokeShare: MeetingHandler;
  sharedArtifacts: MeetingHandler;
  sharedResult: MeetingHandler;
  sharedEvidence: MeetingHandler;
  sharedAnswer: MeetingHandler;
  sharedAnswerEvidence: MeetingHandler;
  confirmDelivery: MeetingHandler;
  speech: MeetingHandler;
  synthesize: MeetingHandler;
  playback: MeetingHandler;
} {
  const handle =
    (
      operation:
        | 'workspace'
        | 'saveWorkspace'
        | 'nativeContext'
        | 'chats'
        | 'chat'
        | 'openChat'
        | 'deleteChat'
        | 'chatMessage'
        | 'access'
        | 'list'
        | 'create'
        | 'detail'
        | 'capture'
        | 'audio'
        | 'transcript'
        | 'lifecycle'
        | 'finalization'
        | 'finalize'
        | 'finalizationRetry'
        | 'finalCorrections'
        | 'finalReview'
        | 'finalEvidence'
        | 'assistant'
        | 'ask'
        | 'evidence'
        | 'voice'
        | 'voiceBegin'
        | 'voiceAudio'
        | 'voiceCancel'
        | 'recipients'
        | 'shares'
        | 'share'
        | 'revokeShare'
        | 'sharedArtifacts'
        | 'sharedResult'
        | 'sharedEvidence'
        | 'sharedAnswer'
        | 'sharedAnswerEvidence'
        | 'confirmDelivery'
        | 'speech'
        | 'synthesize'
        | 'playback',
    ) =>
    async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      const controller = new AbortController();
      const disconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', disconnect);
      let timer: ReturnType<typeof setInterval> | undefined;
      let identityLost = false;
      try {
        const c = deps.config();
        if (!c?.meetingURL || !c.tenantId) throw new MeetingError('MEETING_UNAVAILABLE', 503);
        const user = req.user as MeetingUser | undefined;
        if (
          !user ||
          user.governanceDisabled ||
          user.provider !== 'openid' ||
          !user.identitySessionId ||
          user.openidIssuer !== c.issuer ||
          !z.string().uuid().safeParse(user.openidId).success ||
          (user.tenantId != null && user.tenantId !== c.tenantId)
        ) {
          throw new MeetingError('MEETING_IDENTITY_DENIED', 403);
        }
        let body: string | undefined;
        const descriptor = writeOperations[operation];
        const write = descriptor != null;
        if (descriptor) {
          const origin = req.get('origin');
          let sameOrigin = false;
          try {
            const url = new URL(origin ?? '');
            sameOrigin = url.host === req.get('host') && url.protocol === req.protocol + ':';
          } catch {
            /* Invalid origins fail closed. */
          }
          if (!sameOrigin) throw new MeetingError('ORIGIN_DENIED', 403);
          const parsed = descriptor.schema.safeParse(req.body);
          if (!parsed.success) throw new MeetingError('INVALID_MEETING_INPUT', 422);
          body = JSON.stringify(parsed.data);
        }
        let suffix = operation === 'access' ? '/access' : '';
        if (operation === 'list' && req.query.page !== undefined) {
          const page = z.coerce.number().int().min(1).max(100000).safeParse(req.query.page);
          if (!page.success) throw new MeetingError('INVALID_MEETING_QUERY', 422);
          suffix = '?page=' + page.data;
        }
        if (operation === 'sharedArtifacts') suffix = '/shared';
        if (operation === 'confirmDelivery') suffix = '/delivery';
        if (operation === 'chats') suffix = '/chats';
        if (operation === 'chat') {
          if (!z.string().uuid().safeParse(req.params.chatId).success)
            throw new MeetingError('MEETING_CHAT_NOT_FOUND', 404);
          suffix = '/chats/' + encodeURIComponent(String(req.params.chatId));
        }
        if (
          [
            'workspace',
            'saveWorkspace',
            'nativeContext',
            'openChat',
            'deleteChat',
            'chatMessage',
            'detail',
            'capture',
            'audio',
            'transcript',
            'lifecycle',
            'assistant',
            'ask',
            'evidence',
            'speech',
            'synthesize',
            'playback',
            'finalization',
            'finalize',
            'finalizationRetry',
            'finalCorrections',
            'finalReview',
            'finalEvidence',
            'voice',
            'voiceBegin',
            'voiceAudio',
            'voiceCancel',
            'recipients',
            'shares',
            'share',
            'revokeShare',
            'sharedResult',
            'sharedEvidence',
            'sharedAnswer',
            'sharedAnswerEvidence',
          ].includes(operation)
        ) {
          if (!z.string().uuid().safeParse(req.params.id).success)
            throw new MeetingError('MEETING_NOT_FOUND', 404);
          suffix = '/' + encodeURIComponent(String(req.params.id));
          if (['workspace', 'saveWorkspace'].includes(operation)) suffix += '/workspace';
          else if (operation === 'openChat') suffix += '/chat';
          else if (operation === 'deleteChat') suffix += '/chat/delete';
          else if (operation === 'chatMessage') {
            if (!z.string().uuid().safeParse(req.params.chatId).success)
              throw new MeetingError('MEETING_CHAT_NOT_FOUND', 404);
            suffix += '/chat/' + encodeURIComponent(String(req.params.chatId)) + '/messages';
          } else if (['voice', 'voiceBegin', 'voiceAudio', 'voiceCancel'].includes(operation)) {
            suffix += '/voice-questions';
            if (operation === 'voiceAudio' || operation === 'voiceCancel') {
              if (!z.string().uuid().safeParse(req.params.operationId).success)
                throw new MeetingError('MEETING_VOICE_NOT_FOUND', 404);
              suffix += '/' + encodeURIComponent(String(req.params.operationId));
              suffix += operation === 'voiceAudio' ? '/audio' : '/cancel';
            }
          } else if (
            [
              'recipients',
              'shares',
              'share',
              'revokeShare',
              'sharedResult',
              'sharedEvidence',
            ].includes(operation)
          ) {
            if (operation === 'recipients') {
              const query = z.string().trim().min(1).max(100).safeParse(req.query.q);
              if (!query.success) throw new MeetingError('INVALID_MEETING_QUERY', 422);
              suffix += '/recipients?' + new URLSearchParams({ q: query.data });
            } else if (operation === 'shares' || operation === 'share') suffix += '/sharing';
            else if (operation === 'revokeShare') {
              if (!z.string().uuid().safeParse(req.params.grantId).success)
                throw new MeetingError('MEETING_SHARE_NOT_FOUND', 404);
              suffix += '/sharing/' + encodeURIComponent(String(req.params.grantId)) + '/revoke';
            } else {
              const version = z.coerce
                .number()
                .int()
                .min(1)
                .max(1000000)
                .safeParse(req.query.version);
              if (!version.success) throw new MeetingError('MEETING_ARTIFACT_NOT_FOUND', 404);
              suffix += '/shared';
              const query = new URLSearchParams({ version: String(version.data) });
              if (operation === 'sharedEvidence') {
                const citation = z
                  .object({
                    segment: z.string().uuid(),
                    revision: z.coerce.number().int().min(1).max(1000000),
                  })
                  .safeParse({ segment: req.params.segmentId, revision: req.query.revision });
                if (!citation.success) throw new MeetingError('MEETING_EVIDENCE_NOT_FOUND', 404);
                suffix += '/evidence/' + encodeURIComponent(citation.data.segment);
                query.set('revision', String(citation.data.revision));
              }
              suffix += '?' + query;
            }
          } else if (
            operation === 'finalize' ||
            operation === 'finalizationRetry' ||
            operation === 'finalCorrections' ||
            operation === 'finalReview' ||
            operation === 'finalEvidence'
          ) {
            suffix += '/finalization';
            if (operation === 'finalizationRetry') suffix += '/retry';
            if (operation === 'finalCorrections') suffix += '/corrections';
            if (operation === 'finalReview') suffix += '/review';
            if (operation === 'finalEvidence') {
              const parameters = z
                .object({
                  segment: z.string().uuid(),
                  version: z.coerce.number().int().min(1).max(1000000),
                  revision: z.coerce.number().int().min(1).max(1000000),
                })
                .safeParse({
                  segment: req.params.segmentId,
                  version: req.query.version,
                  revision: req.query.revision,
                });
              if (!parameters.success) throw new MeetingError('MEETING_EVIDENCE_NOT_FOUND', 404);
              suffix +=
                '/evidence/' +
                encodeURIComponent(parameters.data.segment) +
                '?' +
                new URLSearchParams({
                  version: String(parameters.data.version),
                  revision: String(parameters.data.revision),
                });
            }
          } else if (operation !== 'detail')
            suffix +=
              '/' +
              (operation === 'ask'
                ? 'assistant'
                : operation === 'nativeContext'
                  ? 'native-context'
                  : operation);
          if (operation === 'finalization' && req.query.version !== undefined) {
            const version = z.coerce
              .number()
              .int()
              .min(1)
              .max(1000000)
              .safeParse(req.query.version);
            if (!version.success) throw new MeetingError('MEETING_RESULT_NOT_FOUND', 404);
            suffix += '?version=' + encodeURIComponent(String(version.data));
          }
          if (operation === 'evidence') {
            if (
              !z.string().uuid().safeParse(req.params.operationId).success ||
              !z.string().uuid().safeParse(req.params.segmentId).success ||
              !/^[1-9][0-9]{0,8}$/.test(String(req.query.revision))
            )
              throw new MeetingError('MEETING_NOT_FOUND', 404);
            suffix =
              '/' +
              encodeURIComponent(String(req.params.id)) +
              '/assistant/' +
              encodeURIComponent(String(req.params.operationId)) +
              '/evidence/' +
              encodeURIComponent(String(req.params.segmentId)) +
              '?revision=' +
              String(req.query.revision);
          }
          if (['speech', 'synthesize', 'playback'].includes(operation)) {
            const target = operation === 'playback' ? req.params.speechId : req.params.answerId;
            if (!z.string().uuid().safeParse(target).success)
              throw new MeetingError('MEETING_NOT_FOUND', 404);
            suffix =
              '/' +
              encodeURIComponent(String(req.params.id)) +
              (operation === 'playback' ? '/speech/' : '/assistant/') +
              encodeURIComponent(String(target)) +
              (operation === 'playback' ? '/playback' : '/speech');
          }
        }
        if (operation === 'sharedAnswer' || operation === 'sharedAnswerEvidence') {
          if (!z.string().uuid().safeParse(req.params.answerId).success)
            throw new MeetingError('MEETING_ANSWER_NOT_FOUND', 404);
          suffix =
            '/' +
            encodeURIComponent(String(req.params.id)) +
            '/shared/answers/' +
            encodeURIComponent(String(req.params.answerId));
          if (operation === 'sharedAnswerEvidence') {
            const citation = z
              .object({ segment: z.string().uuid(), revision: z.coerce.number().int().positive() })
              .safeParse({ segment: req.params.segmentId, revision: req.query.revision });
            if (!citation.success) throw new MeetingError('MEETING_EVIDENCE_NOT_FOUND', 404);
            suffix +=
              '/evidence/' +
              encodeURIComponent(citation.data.segment) +
              '?revision=' +
              citation.data.revision;
          }
        }
        const headers = {
          Authorization: 'Bearer ' + (await machineToken(c)),
          'Content-Type': 'application/json',
          'X-Meeting-Tenant': c.tenantId,
          'X-Meeting-Issuer': user.openidIssuer!,
          'X-Meeting-Subject': user.openidId!,
          'X-Meeting-Session': user.identitySessionId,
        };
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(descriptor?.timeout ?? 15000),
        ]);
        let checking = false;
        let denied = false;
        const checkIdentity = async () => {
          const sessions = await identitySessions(c, user.openidId!);
          if (!sessions.some((session) => session.id === user.identitySessionId)) {
            denied = true;
            identityLost = true;
            controller.abort();
            throw new MeetingError('IDENTITY_SESSION_REVOKED', 401);
          }
        };
        timer = setInterval(() => {
          if (checking) return;
          checking = true;
          void checkIdentity()
            .catch(() => {
              denied = true;
              identityLost = true;
              controller.abort();
            })
            .finally(() => {
              checking = false;
            });
        }, 3000);
        const response = await c.fetch(c.meetingURL.replace(/\/$/, '') + suffix, {
          method: write ? 'POST' : 'GET',
          headers,
          ...(body ? { body } : {}),
          signal,
        });
        if (!response.ok) {
          const error = (await response.json().catch(() => ({}))) as { code?: string };
          throw new MeetingError(
            error.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'MEETING_UNAVAILABLE',
            [400, 401, 403, 404, 409, 413, 422, 429].includes(response.status)
              ? response.status
              : 503,
          );
        }
        const responseStatus = descriptor?.status ?? 200;
        const value: unknown = await response.json();
        if (denied) throw new MeetingError('IDENTITY_SESSION_REVOKED', 401);
        await checkIdentity();
        if (operation === 'confirmDelivery') {
          if (!controller.signal.aborted && !res.destroyed) res.status(200).json(value);
          return;
        }
        const receipt = response.headers.get('X-Meeting-Delivery');
        if (!receipt) throw new MeetingError('MEETING_DELIVERY_EXPIRED', 403);
        const confirmation = await c.fetch(c.meetingURL.replace(/\/$/, '') + '/delivery', {
          method: 'POST',
          headers,
          body: JSON.stringify({ receipt }),
          signal,
        });
        if (!confirmation.ok) {
          const error = (await confirmation.json().catch(() => ({}))) as { code?: string };
          throw new MeetingError(
            error.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'MEETING_ACCESS_DENIED',
            [401, 403, 404, 409].includes(confirmation.status) ? confirmation.status : 503,
          );
        }
        if (controller.signal.aborted || res.destroyed) return;
        res.setHeader('X-Meeting-Delivery', receipt);
        if (deps.respond) await deps.respond(value, req, res);
        else res.status(responseStatus).json(value);
      } catch (error) {
        if (res.destroyed) return;
        let status = 503,
          code = 'MEETING_UNAVAILABLE';
        if (identityLost) {
          status = 401;
          code = 'IDENTITY_SESSION_REVOKED';
        } else if (error instanceof MeetingError) {
          status = error.status;
          code = error.code;
        }
        if (deps.failure) deps.failure(status, code, req, res);
        else res.status(status).json({ code });
      } finally {
        if (timer) clearInterval(timer);
        res.off('close', disconnect);
      }
    };
  return {
    workspace: handle('workspace'),
    saveWorkspace: handle('saveWorkspace'),
    nativeContext: handle('nativeContext'),
    chats: handle('chats'),
    chat: handle('chat'),
    openChat: handle('openChat'),
    deleteChat: handle('deleteChat'),
    chatMessage: handle('chatMessage'),
    access: handle('access'),
    list: handle('list'),
    create: handle('create'),
    detail: handle('detail'),
    capture: handle('capture'),
    audio: handle('audio'),
    transcript: handle('transcript'),
    lifecycle: handle('lifecycle'),
    finalization: handle('finalization'),
    finalize: handle('finalize'),
    finalizationRetry: handle('finalizationRetry'),
    finalCorrections: handle('finalCorrections'),
    finalReview: handle('finalReview'),
    finalEvidence: handle('finalEvidence'),
    assistant: handle('assistant'),
    ask: handle('ask'),
    evidence: handle('evidence'),
    voice: handle('voice'),
    voiceBegin: handle('voiceBegin'),
    voiceAudio: handle('voiceAudio'),
    voiceCancel: handle('voiceCancel'),
    recipients: handle('recipients'),
    shares: handle('shares'),
    share: handle('share'),
    revokeShare: handle('revokeShare'),
    sharedArtifacts: handle('sharedArtifacts'),
    sharedResult: handle('sharedResult'),
    sharedEvidence: handle('sharedEvidence'),
    sharedAnswer: handle('sharedAnswer'),
    sharedAnswerEvidence: handle('sharedAnswerEvidence'),
    confirmDelivery: handle('confirmDelivery'),
    speech: handle('speech'),
    synthesize: handle('synthesize'),
    playback: handle('playback'),
  };
}
