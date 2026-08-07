// The calendar the whole demo is plotted against: which day is which offset,
// how busy a given day should be, and how creation dates turn into plausible
// close dates. Every other seed*.js module reaches for `timeline` rather than
// computing its own notion of "today" or "how busy is Tuesday" — one source
// for the shape of the year is what keeps the contribution calendar, the
// throughput chart and the close-time histogram all agreeing with each other.
//
// See dayIntensity() below for what "shape" means and why flat randomness
// isn't good enough.
function createTimeline(rng, { days = 92 } = {}) {
  const { rnd, pick, int } = rng;

  const DAYS = days;
  const TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);

  function dayStart(offsetFromStart) {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - (DAYS - 1) + offsetFromStart);
    return d;
  }

  // Work happens on weekdays, in working hours, with a mid-morning and
  // mid-afternoon bump and the occasional late evening. Without this the
  // punchcard and the calendar are a flat wash, which is exactly the thing
  // they exist to show.
  function momentOn(dayOffset) {
    const d = dayStart(dayOffset);
    const hourPool = [9, 10, 10, 11, 11, 13, 14, 14, 15, 15, 16, 17, 20, 21];
    d.setHours(pick(hourPool), int(0, 59), int(0, 59), 0);
    return d;
  }

  // How busy a given day is. Flat randomness produces a calendar where every
  // square is the same shade and every day is active, which reads as generated
  // the moment you look at it. Real logs have shape, so this has four:
  //
  //   weekends      quiet but not empty
  //   a ramp        the first weeks are lighter, as work spins up
  //   sprint rhythm the back half of each fortnight is busier than the front
  //   a week off    one genuine gap, so the calendar has a hole in it
  //
  // ...plus holidays (below), which thin work out on either side of the day
  // itself rather than stopping it dead.
  const VACATION_START = 48;
  const VACATION_DAYS = 6;

  // Public holidays actually falling inside the window, computed for whichever
  // years it spans rather than hardcoded, so the demo still has holidays in it
  // next year.
  function holidaySet() {
    const years = new Set([dayStart(0).getFullYear(), dayStart(DAYS - 1).getFullYear()]);
    const out = new Set();
    const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const nthWeekday = (year, month, weekday, n) => {
      const d = new Date(year, month, 1);
      let count = 0;
      while (d.getMonth() === month) {
        if (d.getDay() === weekday && ++count === n) return new Date(d);
        d.setDate(d.getDate() + 1);
      }
      return null;
    };
    const lastWeekday = (year, month, weekday) => {
      const d = new Date(year, month + 1, 0);
      while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
      return d;
    };
    for (const y of years) {
      const days2 = [
        new Date(y, 0, 1), // New Year's Day
        lastWeekday(y, 4, 1), // Memorial Day
        new Date(y, 5, 19), // Juneteenth
        new Date(y, 6, 4), // Independence Day
        nthWeekday(y, 8, 1, 1), // Labor Day
        nthWeekday(y, 10, 4, 4), // Thanksgiving
        new Date(y, 11, 24),
        new Date(y, 11, 25),
        new Date(y, 11, 26)
      ].filter(Boolean);
      for (const d of days2) out.add(key(d));
      // The Friday after Thanksgiving.
      const tg = nthWeekday(y, 10, 4, 4);
      if (tg) out.add(key(new Date(y, 10, tg.getDate() + 1)));
    }
    return out;
  }
  const HOLIDAYS = holidaySet();
  const holidayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  function holidayFactor(date) {
    if (HOLIDAYS.has(holidayKey(date))) return 0.04;
    for (const delta of [-1, 1]) {
      const near = new Date(date);
      near.setDate(near.getDate() + delta);
      if (HOLIDAYS.has(holidayKey(near))) return 0.5;
    }
    return 1;
  }

  // Weeks differ from each other and days differ within a week. Drawn once
  // from the seeded generator so the variation is stable, and so no two runs
  // of the calendar look subtly different.
  const WEEK_WEIGHT = Array.from({ length: Math.ceil(DAYS / 7) + 1 }, () => 0.55 + rnd() * 0.95);
  const DAY_NOISE = Array.from({ length: DAYS }, () => 0.6 + rnd() * 0.8);

  function dayIntensity(dayOffset) {
    const date = dayStart(dayOffset);
    const dow = date.getDay();
    let w = dow === 0 || dow === 6 ? 0.09 : 1;
    // Fridays wind down a little; Tuesday-Thursday are the solid middle.
    if (dow === 5) w *= 0.78;
    if (dow === 1) w *= 0.92;
    w *= Math.min(1, 0.3 + dayOffset / 26);
    w *= dayOffset % 14 >= 7 ? 1.28 : 0.82;
    w *= WEEK_WEIGHT[Math.floor(dayOffset / 7)];
    w *= DAY_NOISE[dayOffset];
    w *= holidayFactor(date);
    if (dayOffset >= VACATION_START && dayOffset < VACATION_START + VACATION_DAYS) w *= 0.04;
    return w;
  }

  // Cumulative distribution over the window, built once, so picking a day is
  // a single binary search and the shape above is respected everywhere.
  const DAY_CDF = (() => {
    const cdf = [];
    let total = 0;
    for (let d = 0; d < DAYS; d++) {
      total += dayIntensity(d);
      cdf.push(total);
    }
    return cdf.map((v) => v / total);
  })();

  function workday() {
    const r = rnd();
    let lo = 0;
    let hi = DAY_CDF.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (DAY_CDF[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Closures land on a working day too — a burst of completions on a Sunday
  // during the week off would undo everything above.
  //
  // Sampled by rejection rather than by marching forward to the next working
  // day: marching makes every closure that would have fallen on a weekend or
  // during the week off pile onto the single day it resumes, which produced a
  // 67-event Monday spike against a ~20 baseline. Rejection spreads them
  // across the days that follow, in proportion to how busy those days
  // already are.
  //
  // Sampling uniformly across [minGap, maxGap + slop] and accepting by
  // intensity also went wrong, more quietly: it added ~4 days to every close
  // regardless of the duration asked for, so "2-5 days" arrived as two weeks
  // and the histogram reported >=1w as the most common bucket. Walking
  // forward from the intended day keeps the duration close to what
  // closeDuration() drew.
  //
  // Returns null when the event would land after today — the caller decides
  // what "hasn't happened yet" means for its own kind of record.
  function settleDay(fromDay, minGap, maxGap) {
    const start = fromDay + int(minGap, maxGap);
    if (start > DAYS - 1) return null;
    for (let d = start; d <= DAYS - 1 && d < start + 10; d++) {
      // Damped: a plain `rnd() < dayIntensity(d)` clears ~90% of the backlog
      // on the first working day after a weekend, which is the 67-event
      // Monday. Taking a bit over half of it each day spreads the catch-up
      // across the start of the week, which is also how it actually happens.
      if (rnd() < dayIntensity(d) * 0.6) return d;
    }
    // Clamping a run that walks off the end onto the last day is the same
    // mistake as clamping a close: it dropped 31 task_updated events onto
    // yesterday, a 63-event day against a median of 13. It hasn't happened
    // yet.
    return start + 2 > DAYS - 1 ? null : start + 2;
  }

  // How long something takes to close. Heavily skewed short, with a long
  // tail — a uniform pick over "1 to 14 days" puts every single item in the
  // >=1 week bucket and reports an eleven-day average, which is what the
  // time-to-close histogram exists to disprove. Most small work closes the
  // same day or the next one; a minority genuinely drags.
  function closeDuration() {
    const r = rnd();
    if (r < 0.34) return { days: 0, hours: int(1, 7) };
    if (r < 0.62) return { days: 1, hours: int(0, 6) };
    if (r < 0.83) return { days: int(2, 5), hours: int(0, 5) };
    if (r < 0.95) return { days: int(6, 14), hours: int(0, 5) };
    return { days: int(15, 38), hours: int(0, 5) };
  }

  // Turn a creation moment into a closing moment, keeping it inside working
  // hours and off the quiet days. Returns null when the work would close
  // after today.
  function closeMoment(createdOffset, createdAt) {
    const { days, hours } = closeDuration();
    if (days === 0) {
      const t = addHours(createdAt, hours);
      // Same-day closes must not spill past a plausible evening.
      if (t.getHours() >= 8 && t.getHours() <= 22 && t.getDate() === createdAt.getDate()) return t;
      return addHours(createdAt, 2);
    }
    // Something raised three days ago that takes two weeks to close has not
    // closed. Clamping it to the last day instead — which is what every
    // "settle within the window" formulation does implicitly — collected
    // every late long-tail item onto today and reported 16 completions
    // against a baseline of 3. The honest answer is that this one is still
    // open, so say so and let the caller downgrade its status.
    if (createdOffset + days > DAYS - 1) return null;
    const day = settleDay(createdOffset, days, days + 2);
    return day === null ? null : momentOn(day);
  }

  return {
    DAYS,
    TODAY,
    VACATION_START,
    VACATION_DAYS,
    dayStart,
    momentOn,
    dayIntensity,
    workday,
    settleDay,
    closeDuration,
    closeMoment
  };
}

const iso = (d) => new Date(d).toISOString();
const addHours = (d, h) => new Date(new Date(d).getTime() + h * 36e5);

module.exports = { createTimeline, iso, addHours };
