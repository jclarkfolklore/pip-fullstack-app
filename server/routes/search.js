const express = require('express');
const { search } = require('../repo/searchRepo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(search(req.query.q || '', { limit: Number(req.query.limit) || 30 }));
});

module.exports = router;
