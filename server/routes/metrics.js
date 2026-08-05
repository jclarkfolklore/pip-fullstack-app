const express = require('express');
const activityRepo = require('../repo/activityRepo');
const inboxRepo = require('../repo/inboxRepo');
const tasksRepo = require('../repo/tasksRepo');
const notesRepo = require('../repo/notesRepo');

const router = express.Router();

router.get('/', (req, res) => {
  const byDay = activityRepo.throughputByDay(7);
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7.push({ day: key, ...(byDay[key] || { created: 0, resolved: 0, completed: 0 }) });
  }

  res.json({
    last7DaysResolved: last7,
    avgResolutionHours: activityRepo.avgResolutionHours(30),
    inbox: inboxRepo.stageCounts(),
    tasks: tasksRepo.taskCounts(),
    notes: notesRepo.noteCounts(),
    bySourceType: activityRepo.countsBySourceType(),
    byProject: activityRepo.countsByProject(),
    topTags: activityRepo.topTags(6)
  });
});

module.exports = router;
