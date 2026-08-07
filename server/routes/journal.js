const express = require('express');
const journalRepo = require('../repo/journalRepo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(
    journalRepo.listEntries({ search: req.query.search || '', sort: req.query.sort || 'created_desc' })
  );
});

router.get('/counts', (req, res) => {
  res.json({ total: journalRepo.entryCount() });
});

router.post('/', (req, res) => {
  try {
    const id = journalRepo.createEntry(req.body || {});
    res.status(201).json(journalRepo.getEntry(id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const entry = journalRepo.getEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json(entry);
});

router.patch('/:id', (req, res) => {
  const updated = journalRepo.updateEntry(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  journalRepo.deleteEntry(req.params.id);
  res.status(204).end();
});

module.exports = router;
