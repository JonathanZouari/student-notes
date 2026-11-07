// Scoring rules from docs/points-feature.md.
// Pure functions with no DOM access, so they can be tested on their own.
(function (root) {
  const POINTS = { note_created: 10, fix_approved: 5 };
  const DAILY_CAP = 100;
  const MIN_NOTE_LENGTH = 50;
  const LEVELS = [
    { name: 'מתחיל', min: 0 },
    { name: 'פעיל', min: 100 },
    { name: 'מומחה', min: 500 },
  ];

  function dayKey(date) {
    const d = new Date(date);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  // Positive points a user already earned on the same calendar day as `date`.
  function pointsEarnedOnDay(events, userId, date) {
    const key = dayKey(date);
    return events
      .filter((e) => e.user_id === userId && e.points > 0 && dayKey(e.created_at) === key)
      .reduce((sum, e) => sum + e.points, 0);
  }

  // Builds a new point event with the points actually granted.
  // Gives 0 for a too-short note or a fix to your own note, and never goes past the daily cap.
  function createEvent(events, { userId, type, noteId, noteOwnerId = null, contentLength = Infinity, date = new Date() }) {
    const base = POINTS[type];
    if (base === undefined) throw new Error('Unknown event type: ' + type);

    let points = base;
    if (type === 'note_created' && contentLength < MIN_NOTE_LENGTH) points = 0;
    if (type === 'fix_approved' && noteOwnerId === userId) points = 0;

    const leftToday = Math.max(0, DAILY_CAP - pointsEarnedOnDay(events, userId, date));
    points = Math.min(points, leftToday);

    return { user_id: userId, type, note_id: noteId, points, created_at: new Date(date).toISOString() };
  }

  function totalPoints(events, userId) {
    return events.filter((e) => e.user_id === userId).reduce((sum, e) => sum + e.points, 0);
  }

  // The weekly leaderboard resets every Sunday at midnight.
  function weekStart(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  function weeklyPoints(events, userId, now) {
    const start = weekStart(now).getTime();
    return events
      .filter((e) => e.user_id === userId && new Date(e.created_at).getTime() >= start)
      .reduce((sum, e) => sum + e.points, 0);
  }

  function levelFor(points) {
    let index = 0;
    LEVELS.forEach((lvl, i) => { if (points >= lvl.min) index = i; });
    return { index, name: LEVELS[index].name, min: LEVELS[index].min, next: LEVELS[index + 1] || null };
  }

  // Rows sorted by points for the period ('week' or 'all'). Equal points share a rank (1, 1, 3).
  function leaderboard(users, events, { period = 'all', now = new Date() } = {}) {
    const rows = users.map((user) => {
      const total = totalPoints(events, user.id);
      const points = period === 'week' ? weeklyPoints(events, user.id, now) : total;
      return { user, points, total };
    });
    rows.sort((a, b) => b.points - a.points || a.user.name.localeCompare(b.user.name, 'he'));
    rows.forEach((row, i) => {
      row.rank = i > 0 && row.points === rows[i - 1].points ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }

  const api = {
    POINTS, DAILY_CAP, MIN_NOTE_LENGTH, LEVELS,
    pointsEarnedOnDay, createEvent, totalPoints, weekStart, weeklyPoints, levelFor, leaderboard,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Points = api;
})(this);
