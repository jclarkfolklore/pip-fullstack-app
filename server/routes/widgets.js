const express = require('express');
const layoutRepo = require('../repo/layoutRepo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(layoutRepo.listWidgets());
});

router.patch('/:id', (req, res) => {
  if (req.body.sortOrder !== undefined) layoutRepo.setWidgetOrder(req.params.id, req.body.sortOrder);
  if (req.body.enabled !== undefined) layoutRepo.setWidgetEnabled(req.params.id, req.body.enabled);
  res.json(layoutRepo.listWidgets());
});

module.exports = router;
