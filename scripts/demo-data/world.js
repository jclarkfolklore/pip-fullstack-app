// The fictional world: clients, people, tags, and the canned copy that fills
// in for real ticket titles, note bodies and journal entries. Nothing in
// here is real, or based on anything real — see the header of index.js for
// why that matters.
function createWorld(rng) {
  const { pick, sample, chance } = rng;

  const CLIENTS = [
    { name: 'Northwind Health', short: 'NWH', domain: 'northwindhealth.example' },
    { name: 'Lumen Robotics', short: 'LMR', domain: 'lumenrobotics.example' },
    { name: 'Harborline Ferries', short: 'HBL', domain: 'harborline.example' },
    { name: 'Auburn Coffee Co.', short: 'ABC', domain: 'auburncoffee.example' },
    { name: 'Fieldnote CRM', short: 'FCM', domain: 'fieldnote.example' },
    { name: 'PIP (this app)', short: 'PIP', domain: null }
  ];

  const PEOPLE = [
    { name: 'Dana Whitfield', role: 'Project Manager', org: 'Studio' },
    { name: 'Marcus Iyer', role: 'Design Lead', org: 'Studio' },
    { name: 'Priya Raman', role: 'QA', org: 'Studio' },
    { name: 'Sofia Ruiz', role: 'Backend', org: 'Studio' },
    { name: 'Ken Ozawa', role: 'Account Lead', org: 'Studio' },
    { name: 'Tom Beck', role: 'Product Owner', org: 'client' },
    { name: 'Alina Fournier', role: 'Marketing Director', org: 'client' },
    { name: 'Rafael Santos', role: 'IT Manager', org: 'client' }
  ];

  // Tags are grouped so they genuinely co-occur — the tag network is only
  // interesting if the clusters are real, and random tagging produces a
  // hairball.
  const TAG_CLUSTERS = [
    ['frontend', 'accessibility', 'responsive'],
    ['frontend', 'performance', 'lighthouse'],
    ['backend', 'api', 'integration'],
    ['design', 'content', 'copy'],
    ['qa', 'bug', 'regression'],
    ['launch', 'content', 'seo'],
    ['infra', 'deploy', 'monitoring'],
    ['research', 'analytics']
  ];
  const STANDALONE_TAGS = ['quick-win', 'blocked', 'needs-reply', 'mobile'];

  // Tags come mostly from one cluster at a time. Cross-cluster tagging is
  // kept rare on purpose: at 22% every standalone tag ended up co-occurring
  // with every cluster over 400 records, and the result was a hairball of
  // 134 links between 25 nodes rather than readable clusters. A little bleed
  // keeps it from looking synthetic; a lot destroys the clusters.
  function tagSet() {
    const cluster = pick(TAG_CLUSTERS);
    const tags = sample(cluster, rng.int(2, Math.min(3, cluster.length)));
    if (chance(0.09)) tags.push(pick(STANDALONE_TAGS));
    if (chance(0.03)) tags.push(pick(pick(TAG_CLUSTERS)));
    return [...new Set(tags)];
  }

  const SOURCE_TYPES = ['monday', 'ado', 'email', 'chat', 'manual', 'screenshot'];

  function sourceMetaFor(sourceType, client) {
    if (sourceType === 'ado') {
      return {
        Type: pick(['User Story', 'Bug', 'Task']),
        Area: pick(['Frontend', 'Backend', 'Content']),
        Sprint: `Sprint ${rng.int(11, 18)}`,
        'Board state': pick(['Ready', 'Active', 'Ready for Release'])
      };
    }
    if (sourceType === 'monday') {
      return {
        Board: `${client} — DEV — Site Support`,
        Status: pick(['Working on it', 'Ready for QA', 'Stuck', 'Done']),
        Priority: pick(['Low', 'Medium', 'High', 'Critical'])
      };
    }
    return null;
  }

  function sourceRefFor(sourceType) {
    if (sourceType === 'ado') return String(rng.int(180000, 214000));
    if (sourceType === 'monday') return String(rng.int(12000000000, 12999999999));
    return null;
  }

  function sourceUrlFor(sourceType, ref) {
    if (sourceType === 'ado') return `https://dev.azure.com/demo-org/Website/_workitems/edit/${ref}`;
    if (sourceType === 'monday') return `https://demo.monday.com/boards/1234567890/pulses/${ref}`;
    return null;
  }

  const TASK_TITLES = [
    'Fix focus trap in the booking modal',
    'Nav collapses one breakpoint too early',
    'Add skip-to-content link',
    'Product card image aspect ratio drifts on Safari',
    'Compress hero imagery — LCP over 4s on 3G',
    'Wire the newsletter form to the CRM endpoint',
    'Timetable table is unreadable on mobile',
    'Add loading state to the fare calculator',
    'Contrast failures across the footer links',
    'Search returns archived items',
    'Cart total rounds incorrectly at 3 decimal places',
    'Migrate legacy blog URLs with 301s',
    'Sticky header overlaps anchor targets',
    'Empty state missing on the locations map',
    'Date picker rejects valid DD/MM input',
    'Reduce bundle size — vendor chunk is 800kb',
    'Add structured data to the article template',
    'Handle 404s from the availability API',
    'Keyboard focus lost after closing the drawer',
    'Rewrite the checkout copy from the content sheet',
    'Set up preview deploys for the content team',
    'Add analytics events to the signup funnel',
    'Fix double-submit on the contact form',
    'Table headers not announced by screen readers',
    'Pagination resets scroll to the top of the page',
    'Currency formatting ignores locale',
    'Cache-bust the fonts on deploy',
    'Broken hero video on iOS low-power mode'
  ];

  const INBOX_TITLES = [
    'Client asked whether the launch date can move up a week',
    'QA flagged three issues on the staging build',
    'Design handoff for the new pricing page is ready',
    'Analytics shows a drop-off on step 2 of signup',
    'Legal came back with revised disclaimer copy',
    'Request: add a second language to the site',
    'Stakeholder wants a walkthrough of the admin tools',
    'Hosting invoice needs approval before renewal',
    'Accessibility audit results came back',
    'Content team is blocked on the image library',
    'Someone reported the search box not working on mobile',
    'Vendor deprecating the old availability API in 60 days',
    'Ask about analytics access for the client team',
    'Photography for the team page still outstanding',
    'Follow up on the unresolved staging bug',
    'New brand guidelines dropped — check the button styles'
  ];

  const NOTE_BODIES = [
    ({ client, person }) => `**From:** ${person} (${client}), captured after the weekly sync.

## What was agreed

- The launch slips to the first week of the following month; the content team needs the extra time.
- Pricing page ships behind a flag so it can be reviewed on production before going public.
- Accessibility fixes are in scope for this phase, not deferred.

## Open questions

| Question | Owner | Needed by |
| --- | --- | --- |
| Final legal copy for checkout | ${person} | before launch |
| Photography for the team page | Marketing | week 2 |
| Analytics access for the client | Studio | not blocking |

> "We would rather ship a week late than ship something we have to apologise for."

Nothing here changes the agreed scope — see the SOW for what is in and out.`,

    ({ client }) => `Technical notes for the ${client} integration.

## Endpoints in play

The availability service exposes three endpoints we care about:

- \`GET /v2/availability\` — the one the fare calculator hits on every change
- \`POST /v2/hold\` — soft-locks a slot for 10 minutes
- \`POST /v2/confirm\` — turns a hold into a booking

Responses are cached for 60s at the edge, which is why a change in the admin
tool can take a minute to show up on the front end. That is expected, not a bug.

## Gotchas

1. \`/v2/hold\` returns **200 with an error body** rather than a 4xx. Check
   \`body.status\`, not the HTTP code.
2. Timestamps come back without a timezone. They are UTC. Nothing says so.
3. The sandbox environment resets nightly, so test bookings vanish.

\`\`\`js
// The shape that actually comes back, as opposed to the documented one.
{ status: 'unavailable', slots: [], retryAfter: 30 }
\`\`\``,

    ({ client, person }) => `Accessibility audit — ${client}, first pass.

## Summary

23 issues, of which 6 are blockers. The pattern is consistent: components
built early in the project are fine, and everything added in the last month
skipped the checklist.

## Blockers

- Focus is lost when the booking drawer closes — keyboard users land back at
  the top of the document.
- Table headers are not associated with their cells, so the timetable is
  read as a flat list.
- Contrast on footer links is 2.9:1 against the dark background.
- The fare calculator updates without an aria-live region, so the result is
  never announced.
- Skip link is missing entirely.
- Date picker cannot be operated without a mouse.

## Not blockers, but worth doing

Alt text on decorative images should be empty rather than descriptive; several
are currently narrating the border pattern.

Raised with ${person} — the six above are agreed as in-scope for this phase.`,

    () => `A running list of decisions I keep having to re-explain, so they are
written down once.

## Why the build is not on the newer framework version

The upgrade needs the design system to move first, and that is owned by a
different team on a different schedule. Revisit after their Q3.

## Why we cache availability for 60 seconds

The vendor rate-limits at 100 req/min per key. Without the cache a single
busy afternoon exhausts it and the calculator starts failing for everyone.
The staleness is a deliberate trade.

## Why the CMS has two "image" fields

One is legacy and still referenced by the old blog template. Removing it
breaks every post before the migration. It goes when the migration lands.`
  ];

  const JOURNAL_BODIES = [
    ({ client }) => `Spent most of today on the ${client} accessibility pass. The
fixes themselves were small — a focus trap, a couple of aria attributes, some
contrast values — but tracking down *why* focus was escaping the drawer took
the whole morning. It was a stray \`tabindex="0"\` on a wrapper div, added
months ago to make a click handler work.

Worth remembering: when focus behaves strangely, grep for tabindex before
anything else.`,

    ({ client, person }) => `Call with ${person} about the ${client} timeline.
They are under pressure to launch sooner and asked whether we could compress
QA. Said no, and explained what specifically would go untested. They took it
well — I think because I brought the list rather than just the objection.

Note to self: bring the list.`,

    () => `Slow day. Cleared a backlog of small frontend bugs — nothing
individually interesting, but the pile had been bothering me for weeks and
the board looks honest again.

Also finally wrote down the caching decision that keeps coming up in
standups. Three people have now asked the same question; that is a
documentation failure, not a communication one.`,

    ({ client }) => `${client} went live this morning. Deploy was uneventful,
which after the last one is the best possible outcome. Watched the error rate
for an hour, saw nothing, and stopped watching.

The thing that made it calm was the preview deploys — the content team had
already seen every page on real infrastructure, so there were no surprise
"that is not what I approved" moments at the end.`,

    () => `Pairing session on the availability integration. Sofia spotted within
about five minutes that the vendor returns 200 on failure, which I had been
treating as a network flake for two days. Two days.

Reading the response body is apparently not optional.`
  ];

  return {
    CLIENTS,
    PEOPLE,
    TAG_CLUSTERS,
    STANDALONE_TAGS,
    tagSet,
    SOURCE_TYPES,
    sourceMetaFor,
    sourceRefFor,
    sourceUrlFor,
    TASK_TITLES,
    INBOX_TITLES,
    NOTE_BODIES,
    JOURNAL_BODIES
  };
}

module.exports = { createWorld };
