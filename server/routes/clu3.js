const express = require('express');
const clu3Repo = require('../repo/clu3Repo');

const router = express.Router();

// What Clu3 is feeling/saying right now — the only thing the panel polls.
router.get('/', (req, res) => {
  res.json(clu3Repo.currentState());
});

router.get('/tone', (req, res) => {
  res.json({ tone: clu3Repo.getTone() });
});

router.patch('/tone', (req, res) => {
  try {
    res.json({ tone: clu3Repo.setTone((req.body || {}).tone) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/messages', (req, res) => {
  res.json(clu3Repo.listMessages({ includeSpent: req.query.all === '1' }));
});

// How a Claude session gives Clu3 something specific to say.
router.post('/messages', (req, res) => {
  try {
    const id = clu3Repo.createMessage(req.body || {});
    res.status(201).json(clu3Repo.getMessage(id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/messages/:id/dismiss', (req, res) => {
  const updated = clu3Repo.dismissMessage(req.params.id);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.delete('/messages/:id', (req, res) => {
  clu3Repo.deleteMessage(req.params.id);
  res.status(204).end();
});

module.exports = router;
