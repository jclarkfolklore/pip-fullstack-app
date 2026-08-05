const express = require('express');
const projectsRepo = require('../repo/projectsRepo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(projectsRepo.listProjects({ includeArchived: req.query.includeArchived === '1' }));
});

router.post('/', (req, res) => {
  try {
    const id = projectsRepo.createProject(req.body || {});
    res.status(201).json(projectsRepo.getProject(id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const project = projectsRepo.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  res.json(project);
});

router.patch('/:id', (req, res) => {
  const updated = projectsRepo.updateProject(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  try {
    projectsRepo.deleteProject(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
