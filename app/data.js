// Sample data so the app has something to show before there is a real backend.
// Dates are relative to today, so the weekly leaderboard always has activity.
(function (root) {
  const P = root.Points;

  const users = [
    { id: 1, name: 'נועה לוי' },
    { id: 2, name: 'איתי כהן' },
    { id: 3, name: 'מאיה פרץ' },
    { id: 4, name: 'יונתן אברהם' },
    { id: 5, name: 'שירה מזרחי' },
    { id: 6, name: 'דניאל ביטון' },
  ];

  // [new notes, approved fixes] per user over the last 60 days.
  const activity = { 1: [54, 20], 2: [30, 22], 3: [16, 10], 4: [8, 3], 5: [4, 6], 6: [1, 2] };

  // Small seeded random generator, so the sample looks the same on every load.
  let seed = 7;
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  const now = new Date();
  function randomDate() {
    const d = new Date(now);
    d.setDate(d.getDate() - Math.floor(rand() * 60));
    d.setHours(8 + Math.floor(rand() * 14), Math.floor(rand() * 60), 0, 0);
    return d > now ? now : d;
  }

  // Plan every action first, then score them in time order so the daily cap applies correctly.
  const planned = [];
  users.forEach((user) => {
    const [notes, fixes] = activity[user.id];
    for (let i = 0; i < notes; i++) planned.push({ userId: user.id, type: 'note_created', date: randomDate() });
    for (let i = 0; i < fixes; i++) planned.push({ userId: user.id, type: 'fix_approved', date: randomDate() });
  });
  planned.sort((a, b) => a.date - b.date);

  const notes = []; // { id, ownerId }
  const events = [];
  planned.forEach((p) => {
    if (p.type === 'note_created') {
      const noteId = notes.length + 1;
      notes.push({ id: noteId, ownerId: p.userId });
      events.push(P.createEvent(events, { userId: p.userId, type: p.type, noteId, date: p.date }));
      return;
    }
    const others = notes.filter((n) => n.ownerId !== p.userId);
    if (others.length === 0) return;
    const note = others[Math.floor(rand() * others.length)];
    events.push(P.createEvent(events, {
      userId: p.userId, type: p.type, noteId: note.id, noteOwnerId: note.ownerId, date: p.date,
    }));
  });

  // One deleted note, to show how revoked points look in the history.
  const deleted = events.find((e) => e.user_id === 2 && e.type === 'note_created' && e.points > 0);
  if (deleted) {
    events.push({
      user_id: 2, type: 'revoked', note_id: deleted.note_id, points: -deleted.points,
      created_at: new Date(new Date(deleted.created_at).getTime() + 3600 * 1000).toISOString(),
    });
  }

  root.SampleData = { users, events, notes };
})(this);
