const express = require('express');
const activityRepo = require('../repo/activityRepo');
const inboxRepo = require('../repo/inboxRepo');
const tasksRepo = require('../repo/tasksRepo');
const notesRepo = require('../repo/notesRepo');
const journalRepo = require('../repo/journalRepo');
const attachmentsRepo = require('../repo/attachmentsRepo');
const projectsRepo = require('../repo/projectsRepo');

const router = express.Router();

const FLOW_DAYS = 28;
// ~26 weeks — enough columns for the contribution calendar to read as a
// stretch of time rather than a couple of stripes.
const CALENDAR_DAYS = 182;

// Local calendar date key (YYYY-MM-DD), matching activityRepo's local-time
// bucketing — toISOString() would drift a day west of UTC, which was the
// original bug this whole redesign started from.
function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

router.get('/', (req, res) => {
  const byDay = activityRepo.throughputByDay(FLOW_DAYS);
  const throughput = [];
  for (let i = FLOW_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    throughput.push({ day: key, ...(byDay[key] || { created: 0, resolved: 0, completed: 0 }) });
  }

  res.json({
    // NOW — current state, no history involved.
    inbox: inboxRepo.stageCounts(),
    tasks: tasksRepo.taskCounts(),
    notes: notesRepo.noteCounts(),
    journalCount: journalRepo.entryCount(),
    attachmentCount: attachmentsRepo.totalCount(),
    projectCount: projectsRepo.listProjects().length,
    byProject: activityRepo.countsByProject(),

    // FLOW — everything derived from activity_log.
    firstEventAt: activityRepo.firstEventAt(),
    throughput,
    activityByHour: activityRepo.activityByHour(FLOW_DAYS),
    dailyActivity: activityRepo.dailyActivity(CALENDAR_DAYS),
    completionsByProject: activityRepo.completionsByProject(FLOW_DAYS),
    closeTimeBuckets: activityRepo.closeTimeBuckets(30),
    avgResolutionHours: activityRepo.avgResolutionHours(30),
    bySourceType: activityRepo.countsBySourceType(),
    tagGraph: activityRepo.tagGraph(),
    activityByCategory: activityRepo.activityByCategory(7),
    recent: activityRepo.recentActivity(40)
  });
});

module.exports = router;
