const express = require('express');
const { meetingChatDetailSchema } = require('librechat-data-provider');
const {
  createMeetingGateway,
  gatewayConfig,
  mergeMeetingChatDetail,
} = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');
const { logger, CLIENT_MESSAGE_SELECT } = require('@librechat/data-schemas');
const router = express.Router();
const logFailure = (status, code, req, res) => {
  logger.warn(`[meetings] ${req.method} ${req.originalUrl} refused: ${code} (${status})`, {
    userId: req.user?.id,
    code,
    status,
  });
  res.status(status).json({ code });
};
const handlers = createMeetingGateway({
  config: gatewayConfig,
  failure: logFailure,
});
const chatHandler = createMeetingGateway({
  config: gatewayConfig,
  failure: logFailure,
  respond: async (value, req, res) => {
    const detail = meetingChatDetailSchema.parse(value);
    const conversationId = `meeting-${detail.chat.meeting_id}-${detail.chat.id}`;
    const { getMessages } = require('~/models');
    const storedMessages = await getMessages(
      { user: req.user.id, conversationId },
      CLIENT_MESSAGE_SELECT,
    );
    res.status(200).json(mergeMeetingChatDetail(detail, storedMessages));
  },
}).chat;
router.use(requireJwtAuth);
router.get('/access', handlers.access);
router.get('/', handlers.list);
router.post('/', handlers.create);
router.get('/shared', handlers.sharedArtifacts);
router.post('/delivery', handlers.confirmDelivery);
router.get('/chats', handlers.chats);
router.get('/chats/:chatId', chatHandler);
router.get('/:id/workspace', handlers.workspace);
router.post('/:id/workspace', handlers.saveWorkspace);
router.post('/:id/chat', handlers.openChat);
router.post('/:id/chat/delete', handlers.deleteChat);
router.post('/:id/chat/:chatId/messages', handlers.chatMessage);
router.get('/:id', handlers.detail);
router.get('/:id/recipients', handlers.recipients);
router.get('/:id/sharing', handlers.shares);
router.post('/:id/sharing', handlers.share);
router.post('/:id/sharing/:grantId/revoke', handlers.revokeShare);
router.get('/:id/shared', handlers.sharedResult);
router.get('/:id/shared/evidence/:segmentId', handlers.sharedEvidence);
router.get('/:id/shared/answers/:answerId', handlers.sharedAnswer);
router.get('/:id/shared/answers/:answerId/evidence/:segmentId', handlers.sharedAnswerEvidence);
router.post('/:id/capture', handlers.capture);
router.post('/:id/audio', handlers.audio);
router.get('/:id/transcript', handlers.transcript);
router.get('/:id/lifecycle', handlers.lifecycle);
router.get('/:id/voice-questions', handlers.voice);
router.post('/:id/voice-questions', handlers.voiceBegin);
router.post('/:id/voice-questions/:operationId/audio', handlers.voiceAudio);
router.post('/:id/voice-questions/:operationId/cancel', handlers.voiceCancel);
router.get('/:id/finalization', handlers.finalization);
router.post('/:id/finalization', handlers.finalize);
router.post('/:id/finalization/retry', handlers.finalizationRetry);
router.post('/:id/finalization/corrections', handlers.finalCorrections);
router.post('/:id/finalization/review', handlers.finalReview);
router.get('/:id/finalization/evidence/:segmentId', handlers.finalEvidence);
router.get('/:id/assistant', handlers.assistant);
router.post('/:id/assistant', handlers.ask);
router.get('/:id/assistant/:operationId/evidence/:segmentId', handlers.evidence);
router.get('/:id/assistant/:answerId/speech', handlers.speech);
router.post('/:id/assistant/:answerId/speech', handlers.synthesize);
router.post('/:id/speech/:speechId/playback', handlers.playback);
module.exports = router;
