const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');

const router = express.Router();
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_VERSIONS = 20;

const versionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const publishedArtifactSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    user: { type: String, required: true, index: true },
    artifactId: { type: String, required: true },
    title: { type: String, default: 'HelloDigi artifact' },
    content: { type: String, required: true },
    versions: { type: [versionSchema], default: [] },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

publishedArtifactSchema.index({ user: 1, artifactId: 1 }, { unique: true });

const PublishedArtifact =
  mongoose.models.PublishedArtifact ||
  mongoose.model('PublishedArtifact', publishedArtifactSchema, 'published_artifacts');

router.get('/public/:slug', async (req, res) => {
  try {
    const artifact = await PublishedArtifact.findOne({ slug: req.params.slug }).lean();
    if (!artifact) {
      return res.status(404).type('text/plain').send('Artifact tidak ditemukan.');
    }
    res.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self' data: blob: https:; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src https:; frame-ancestors 'self' http://app.hellodigi.localhost:8080",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).type('html').send(artifact.content);
  } catch (error) {
    logger.error('[artifacts] Unable to serve published artifact', error);
    return res.status(500).type('text/plain').send('Artifact gagal dimuat.');
  }
});

router.use(requireJwtAuth);

router.post('/publish', async (req, res) => {
  try {
    const artifactId = String(req.body?.artifactId ?? '').trim();
    const title = String(req.body?.title ?? 'HelloDigi artifact').trim().slice(0, 200);
    const content = String(req.body?.content ?? '');
    const contentSize = Buffer.byteLength(content, 'utf8');
    if (!artifactId || !content) {
      return res.status(400).json({ error: 'artifactId and content are required' });
    }
    if (contentSize > MAX_ARTIFACT_BYTES) {
      return res.status(413).json({ error: 'Artifact exceeds the 2 MB publish limit' });
    }

    const user = String(req.user.id ?? '');
    let artifact = await PublishedArtifact.findOne({ user, artifactId });
    if (!artifact) {
      artifact = new PublishedArtifact({
        slug: crypto.randomBytes(10).toString('hex'),
        user,
        artifactId,
        title,
        content,
        versions: [],
      });
    }

    const version = (artifact.versions.at(-1)?.version ?? 0) + 1;
    artifact.title = title;
    artifact.content = content;
    artifact.publishedAt = new Date();
    artifact.versions.push({ version, content, createdAt: new Date() });
    if (artifact.versions.length > MAX_VERSIONS) {
      artifact.versions = artifact.versions.slice(-MAX_VERSIONS);
    }
    await artifact.save();

    const origin =
      process.env.ARTIFACT_PUBLIC_ORIGIN || 'http://artifact.hellodigi.localhost:8080';
    return res.status(200).json({
      slug: artifact.slug,
      version,
      url: `${origin}/api/artifacts/public/${artifact.slug}`,
      publishedAt: artifact.publishedAt,
    });
  } catch (error) {
    logger.error('[artifacts] Unable to publish artifact', error);
    return res.status(500).json({ error: 'Artifact could not be published' });
  }
});

router.get('/:artifactId/versions', async (req, res) => {
  try {
    const artifact = await PublishedArtifact.findOne({
      user: String(req.user.id ?? ''),
      artifactId: req.params.artifactId,
    }).lean();
    if (!artifact) {
      return res.status(404).json({ error: 'Published artifact not found' });
    }
    return res.status(200).json({
      slug: artifact.slug,
      title: artifact.title,
      versions: artifact.versions.map(({ version, createdAt }) => ({ version, createdAt })),
    });
  } catch (error) {
    logger.error('[artifacts] Unable to list artifact versions', error);
    return res.status(500).json({ error: 'Artifact versions could not be loaded' });
  }
});

module.exports = router;
