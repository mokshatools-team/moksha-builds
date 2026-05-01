'use strict';
const express = require('express');
const { normalizeImages, MAX_IMAGE_COUNT } = require('../lib/image-upload');
const router = express.Router();

// Dependencies injected via init
let attachmentService, getJob, upload, sendUploadError;

function init(deps) {
  attachmentService = deps.attachmentService;
  getJob = deps.getJob;
  upload = deps.upload;
  sendUploadError = deps.sendUploadError;
}

// List attachments for a session
router.get('/api/sessions/:id/attachments', async (req, res) => {
  try {
    res.json(await attachmentService.listAttachments({ sessionId: req.params.id }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List attachments for a job
router.get('/api/jobs/:id/attachments', async (req, res) => {
  try {
    res.json(await attachmentService.listAttachments({ jobId: req.params.id }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload attachments directly to a job (no chat session needed)
router.post('/api/jobs/:id/attachments', async (req, res) => {
  upload.array('images', MAX_IMAGE_COUNT)(req, res, async (err) => {
    if (err) {
      const handled = sendUploadError(res, err);
      if (handled) return;
      return res.status(500).json({ error: 'Upload failed' });
    }
    try {
      const job = await getJob(req.params.id);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      const normalizedImages = await normalizeImages(req.files || []);
      if (!normalizedImages.length) return res.status(400).json({ error: 'No images' });
      const results = [];
      for (const img of normalizedImages) {
        const result = await attachmentService.uploadAttachment({
          file: img, sessionId: job.quote_session_id || '', jobId: req.params.id,
          pathPrefix: `jobs/${req.params.id}`,
        });
        if (result) results.push(result);
      }
      res.json({ ok: true, uploaded: results });
    } catch (e) {
      console.error('Job attachment error:', e);
      res.status(500).json({ error: e.message });
    }
  });
});

// Delete an attachment
router.delete('/api/attachments/:id', async (req, res) => {
  try {
    const att = await attachmentService.deleteAttachment(req.params.id);
    if (!att) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, init };
