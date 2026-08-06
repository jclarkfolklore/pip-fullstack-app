const express = require('express');
const fs = require('fs');
const attachments = require('../repo/attachmentsRepo');

const router = express.Router();

// Everything hanging off one entity.
//   GET /api/attachments?entityType=task&entityId=ado-183767
// `entityIds` (comma-separated) returns a map keyed by id instead — so a list
// of cards can show thumbnails in one request rather than one per card.
router.get('/', (req, res) => {
  const { entityType, entityId, entityIds } = req.query;
  if (!entityType) return res.status(400).json({ error: 'entityType is required' });
  try {
    if (entityIds !== undefined) {
      const ids = String(entityIds).split(',').map((s) => s.trim()).filter(Boolean);
      return res.json(attachments.listForMany(entityType, ids));
    }
    if (!entityId) return res.status(400).json({ error: 'entityId or entityIds is required' });
    res.json(attachments.listFor(entityType, entityId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// The bytes of a stored image. Streamed from disk rather than served
// statically so the file layout stays an implementation detail and nothing
// outside data/attachments/ is reachable by guessing a path.
router.get('/:id/raw', (req, res) => {
  const file = attachments.rawFileFor(req.params.id);
  if (!file) return res.status(404).json({ error: 'not found' });
  res.type(file.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(file.path).pipe(res);
});

// Add a link or an image. Images can arrive as base64 `data` or as a `url` to
// fetch; a fetch that fails degrades to a link rather than failing the call,
// and says so in `degraded`.
router.post('/', async (req, res) => {
  try {
    const result = await attachments.addAttachment(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const ok = attachments.deleteAttachment(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// Manual orphan cleanup. Entity deletes already clean up after themselves;
// this catches anything that predates that or slipped through.
router.post('/sweep', (req, res) => {
  res.json(attachments.sweepOrphans());
});

module.exports = router;
