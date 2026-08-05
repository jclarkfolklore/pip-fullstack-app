const express = require('express');
const { db, DB_PATH } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  // Flush WAL into the main file first so the downloaded copy is complete
  // and openable by any plain SQLite tool, not just this server.
  db.pragma('wal_checkpoint(TRUNCATE)');
  res.download(DB_PATH, `pip-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
});

module.exports = router;
