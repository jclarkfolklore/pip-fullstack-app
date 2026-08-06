const express = require('express');
const tasksRepo = require('../repo/tasksRepo');

const router = express.Router();

router.get('/', (req, res) => {
  const { status, project, tag, search, sort } = req.query;
  res.json(
    tasksRepo.listTasks({
      status: status || null,
      project: project || null,
      tag: tag || null,
      search: search || '',
      sort: sort || 'created_desc'
    })
  );
});

router.get('/counts', (req, res) => {
  res.json(tasksRepo.taskCounts());
});

// Idempotent create-with-id, for syncing external work in (see
// scripts/pip-upsert.js). Re-running a sync updates instead of duplicating.
router.post('/import', (req, res) => {
  try {
    const result = tasksRepo.importTask(req.body || {});
    res.status(result.created ? 201 : 200).json(tasksRepo.getTask(result.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  const id = tasksRepo.createTask(req.body || {});
  res.status(201).json(tasksRepo.getTask(id));
});

router.get('/:id', (req, res) => {
  const task = tasksRepo.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json(task);
});

router.patch('/:id', (req, res) => {
  const updated = tasksRepo.updateFields(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.post('/:id/status', (req, res) => {
  tasksRepo.setTaskStatus(req.params.id, req.body.status);
  res.json(tasksRepo.getTask(req.params.id));
});

router.delete('/:id', (req, res) => {
  tasksRepo.deleteTask(req.params.id);
  res.status(204).end();
});

module.exports = router;
