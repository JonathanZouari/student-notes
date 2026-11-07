(function () {
  const P = window.Points;
  const { users, events, notes } = window.SampleData;
  const state = { period: 'week', selectedId: null };

  const EVENT_LABEL = { note_created: 'הערה חדשה', fix_approved: 'תיקון מאושר', revoked: 'הערה נמחקה' };
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => name.split(' ').map((w) => w[0]).join('').slice(0, 2);
  const fmtDate = (iso) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });

  function badge(lvl) {
    return `<span class="badge lvl-${lvl.index}">${lvl.name}</span>`;
  }

  function renderBoard() {
    const rows = P.leaderboard(users, events, { period: state.period, now: new Date() });
    if (state.selectedId === null) state.selectedId = rows[0].user.id;

    $('#leaderboard').innerHTML = rows.map((r) => `
      <li>
        <button class="row${r.user.id === state.selectedId ? ' is-selected' : ''}" data-id="${r.user.id}">
          <span class="rank${r.rank <= 3 ? ' is-top' : ''}">${r.rank}</span>
          <span class="avatar">${esc(initials(r.user.name))}</span>
          <span class="name">${esc(r.user.name)} ${badge(P.levelFor(r.total))}</span>
          <span class="pts">${r.points}<small> נק'</small></span>
        </button>
      </li>`).join('');

    document.querySelectorAll('.tabs button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.period === state.period));
    });
  }

  function renderProfile() {
    const user = users.find((u) => u.id === state.selectedId);
    const now = new Date();
    const total = P.totalPoints(events, user.id);
    const week = P.weeklyPoints(events, user.id, now);
    const today = P.pointsEarnedOnDay(events, user.id, now);
    const lvl = P.levelFor(total);
    const progress = lvl.next ? Math.round(((total - lvl.min) / (lvl.next.min - lvl.min)) * 100) : 100;
    const history = events
      .filter((e) => e.user_id === user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 8);

    $('#profile').innerHTML = `
      <div class="p-head">
        <span class="avatar lg">${esc(initials(user.name))}</span>
        <div>
          <h2>${esc(user.name)}</h2>
          ${badge(lvl)}
        </div>
      </div>
      <div class="big">${total}<small> נקודות</small></div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <div style="width:${progress}%"></div>
      </div>
      <p class="muted">${lvl.next ? `עוד ${lvl.next.min - total} נקודות לרמת ${lvl.next.name}` : 'הגיע/ה לרמה הגבוהה ביותר'}</p>
      <div class="stats">
        <div><b>${week}</b><span>השבוע</span></div>
        <div><b>${today}/${P.DAILY_CAP}</b><span>היום</span></div>
      </div>
      <div class="actions">
        <button data-action="note_created">+ הערה חדשה</button>
        <button data-action="fix_approved">+ תיקון מאושר</button>
      </div>
      <h3>היסטוריה</h3>
      <ul class="history">
        ${history.map((e) => `
          <li>
            <span>${EVENT_LABEL[e.type]} <span class="muted">· הערה #${e.note_id}</span></span>
            <span class="delta${e.points < 0 ? ' neg' : ''}" dir="ltr">${e.points > 0 ? '+' : ''}${e.points}</span>
            <time datetime="${e.created_at}">${fmtDate(e.created_at)}</time>
          </li>`).join('')}
      </ul>`;
  }

  function render() {
    renderBoard();
    renderProfile();
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // Simulates a user action so the scoring rules can be tried out.
  function addAction(type) {
    const userId = state.selectedId;
    let event;
    if (type === 'note_created') {
      const noteId = notes.length + 1;
      notes.push({ id: noteId, ownerId: userId });
      event = P.createEvent(events, { userId, type, noteId });
    } else {
      const others = notes.filter((n) => n.ownerId !== userId);
      const note = others[Math.floor(Math.random() * others.length)];
      event = P.createEvent(events, { userId, type, noteId: note.id, noteOwnerId: note.ownerId });
    }
    events.push(event);
    toast(event.points > 0
      ? `קיבלת ${event.points} נקודות!`
      : `הגעת לתקרה היומית (${P.DAILY_CAP} נקודות). אין נקודות נוספות היום.`);
    render();
  }

  $('#leaderboard').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    state.selectedId = Number(row.dataset.id);
    render();
  });

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-period]');
    if (!tab) return;
    state.period = tab.dataset.period;
    render();
  });

  $('#profile').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) addAction(btn.dataset.action);
  });

  render();
})();
