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

// Everything belonging to a project — powers the detail modal.
router.get('/:id/contents', (req, res) => {
  const project = projectsRepo.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  res.json({ project, contents: projectsRepo.projectContents(req.params.id) });
});

router.get('/:id/contacts', (req, res) => {
  res.json(projectsRepo.listContacts(req.params.id));
});

router.post('/:id/contacts', (req, res) => {
  try {
    res.status(201).json(projectsRepo.addContact(req.params.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/contacts/:contactId', (req, res) => {
  const updated = projectsRepo.updateContact(req.params.contactId, req.body || {});
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.delete('/contacts/:contactId', (req, res) => {
  const ok = projectsRepo.deleteContact(req.params.contactId);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
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
