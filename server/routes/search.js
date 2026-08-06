const express = require('express');
const { search, searchIndex } = require('../repo/searchRepo');

const router = express.Router();

// The whole searchable set, already shaped like search results. Captured by
// the static snapshot, which filters it client-side — see searchRepo for why
// this shares its queries with search() rather than having its own.
router.get('/index', (req, res) => {
  res.json(searchIndex());
});

router.get('/', (req, res) => {
  res.json(search(req.query.q || '', { limit: Number(req.query.limit) || 30 }));
});

module.exports = router;
