const express = require('express');
const notesRepo = require('../repo/notesRepo');

const router = express.Router();

router.get('/', (req, res) => {
  const { project, tag, search, pinned, sort } = req.query;
  res.json(
    notesRepo.listNotes({
      project: project || null,
      tag: tag || null,
      search: search || '',
      pinned: pinned === undefined ? null : pinned === '1',
      sort: sort || 'updated_desc'
    })
  );
});

router.get('/counts', (req, res) => {
  res.json(notesRepo.noteCounts());
});

router.post('/', (req, res) => {
  const id = notesRepo.createNote(req.body || {});
  res.status(201).json(notesRepo.getNote(id));
});

router.get('/:id', (req, res) => {
  const note = notesRepo.getNote(req.params.id);
  if (!note) return res.status(404).json({ error: 'not found' });
  res.json(note);
});

router.patch('/:id', (req, res) => {
  const updated = notesRepo.updateFields(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  notesRepo.deleteNote(req.params.id);
  res.status(204).end();
});

module.exports = router;
