const express = require('express');
const { allTagNames } = require('../repo/tagsRepo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(allTagNames());
});

module.exports = router;
