const path = require('path');
const express = require('express');
const multer = require('multer');
const { logger } = require('@librechat/data-schemas');
const { MCPTokenStorage } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const db = require('~/models');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

const GOOGLE_MIME_BY_EXTENSION = {
  '.doc': 'application/vnd.google-apps.document',
  '.docx': 'application/vnd.google-apps.document',
  '.xls': 'application/vnd.google-apps.spreadsheet',
  '.xlsx': 'application/vnd.google-apps.spreadsheet',
  '.csv': 'application/vnd.google-apps.spreadsheet',
  '.ppt': 'application/vnd.google-apps.presentation',
  '.pptx': 'application/vnd.google-apps.presentation',
};

const EDITOR_BASE_BY_MIME = {
  'application/vnd.google-apps.document': 'https://docs.google.com/document/d',
  'application/vnd.google-apps.spreadsheet': 'https://docs.google.com/spreadsheets/d',
  'application/vnd.google-apps.presentation': 'https://docs.google.com/presentation/d',
};

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_WORKSPACE_MCP_CLIENT_ID && process.env.GOOGLE_WORKSPACE_MCP_CLIENT_SECRET,
  );
}

async function getDriveToken(userId) {
  try {
    return await MCPTokenStorage.getTokens({
      userId,
      serverName: 'google-drive',
      findToken: db.findToken,
    });
  } catch (error) {
    logger.debug('[google-workspace] Drive authorization is not ready', { error });
    return null;
  }
}

router.use(requireJwtAuth);

router.get('/status', async (req, res) => {
  const configured = isConfigured();
  const tokens = configured ? await getDriveToken(String(req.user.id ?? '')) : null;
  return res.status(200).json({
    configured,
    connected: Boolean(tokens?.access_token),
    serverName: 'google-drive',
  });
});

router.post('/import', upload.single('file'), async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({
      code: 'GOOGLE_WORKSPACE_NOT_CONFIGURED',
      error: 'Google Workspace OAuth client is not configured',
    });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'A DOCX, XLSX, CSV, or PPTX file is required' });
  }
  const extension = path.extname(req.file.originalname).toLowerCase();
  const googleMime = GOOGLE_MIME_BY_EXTENSION[extension];
  if (!googleMime) {
    return res.status(415).json({ error: 'This file type cannot be opened in Google Workspace' });
  }
  const tokens = await getDriveToken(String(req.user.id ?? ''));
  if (!tokens?.access_token) {
    return res.status(409).json({
      code: 'GOOGLE_DRIVE_NOT_CONNECTED',
      error: 'Connect Google Drive before opening this file',
    });
  }

  try {
    const form = new FormData();
    const baseName = path.basename(req.file.originalname, extension).slice(0, 180);
    form.append(
      'metadata',
      new Blob([JSON.stringify({ name: baseName, mimeType: googleMime })], {
        type: 'application/json; charset=UTF-8',
      }),
    );
    form.append(
      'file',
      new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' }),
      req.file.originalname,
    );
    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        body: form,
      },
    );
    const body = await response.json();
    if (!response.ok || !body.id) {
      logger.warn('[google-workspace] Drive conversion failed', {
        status: response.status,
        reason: body?.error?.status,
      });
      return res.status(response.status === 401 ? 409 : 502).json({
        code: response.status === 401 ? 'GOOGLE_DRIVE_NOT_CONNECTED' : 'GOOGLE_DRIVE_IMPORT_FAILED',
        error: 'Google Drive could not convert the file',
      });
    }
    const editorBase = EDITOR_BASE_BY_MIME[googleMime];
    return res.status(201).json({
      fileId: body.id,
      name: body.name,
      mimeType: body.mimeType,
      editorUrl: body.webViewLink || `${editorBase}/${body.id}/edit`,
    });
  } catch (error) {
    logger.error('[google-workspace] Drive import failed', error);
    return res.status(502).json({ error: 'Google Drive import failed' });
  }
});

module.exports = router;
