const express = require('express');
const inboxRepo = require('../repo/inboxRepo');
const tasksRepo = require('../repo/tasksRepo');
const { allTagNames } = require('../repo/tagsRepo');

const router = express.Router();

router.get('/', (req, res) => {
  const { stage, tag, project, search, sort } = req.query;
  res.json(inboxRepo.listInboxItems({ stage: stage || null, tag: tag || null, project: project || null, search: search || '', sort: sort || 'created_desc' }));
});

router.get('/tags', (req, res) => {
  res.json(allTagNames());
});

router.get('/counts', (req, res) => {
  res.json(inboxRepo.stageCounts());
});

router.post('/', (req, res) => {
  const id = inboxRepo.createInboxItem(req.body || {});
  res.status(201).json(inboxRepo.getInboxItem(id));
});

// Idempotent create-with-id, for syncing external work in (see
// scripts/pip-upsert.js). Same importer the drops watcher uses, so re-running
// a sync updates instead of duplicating.
router.post('/import', (req, res) => {
  try {
    const result = inboxRepo.importDroppedNote(req.body || {});
    res.status(result.created ? 201 : 200).json(inboxRepo.getInboxItem(result.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const item = inboxRepo.getInboxItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

router.patch('/:id', (req, res) => {
  const updated = inboxRepo.updateFields(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.post('/:id/stage', (req, res) => {
  inboxRepo.setStage(req.params.id, req.body.stage);
  res.json(inboxRepo.getInboxItem(req.params.id));
});

router.post('/:id/resolve', (req, res) => {
  const { outcomeMd = '', taskTitles = [] } = req.body || {};
  inboxRepo.resolveWithOutcome(req.params.id, outcomeMd);
  const titles = Array.isArray(taskTitles) ? taskTitles.map((t) => String(t || '').trim()).filter(Boolean) : [];
  for (const title of titles) {
    tasksRepo.createTask({ title, notesMd: outcomeMd, fromInboxItemId: req.params.id });
  }
  res.json(inboxRepo.getInboxItem(req.params.id));
});

router.post('/:id/archive', (req, res) => {
  inboxRepo.archiveItem(req.params.id);
  res.json(inboxRepo.getInboxItem(req.params.id));
});

router.post('/:id/deactivate', (req, res) => {
  const updated = inboxRepo.deactivateItem(req.params.id);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.post('/:id/reactivate', (req, res) => {
  const updated = inboxRepo.reactivateItem(req.params.id);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  inboxRepo.deleteItem(req.params.id);
  res.status(204).end();
});

module.exports = router;
