const express = require('express');
const { recentActivity } = require('../repo/activityRepo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(recentActivity(Number(req.query.limit) || 50));
});

module.exports = router;
