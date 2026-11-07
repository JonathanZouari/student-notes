// Student Notes – צד לקוח (Vanilla JS)
const $ = (s, el = document) => el.querySelector(s);
const state = { token: localStorage.getItem("sn_token"), me: null, years: [], course: null, tab: null, poll: null };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: "Bearer " + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") { logout(true); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || "שגיאה");
  return data;
}

const fmtDate = (t) => new Date(t * 1000).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
const fmtSize = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1) + " MB";
const fileIcon = (m = "") => m.includes("pdf") ? "📕" : m.startsWith("image") ? "🖼️" : m.includes("word") ? "📘" : m.includes("presentation") || m.includes("powerpoint") ? "📙" : "📄";

// ---------------------------------------------------------------- auth
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("#login-error").textContent = "";
  try {
    const { token } = await api("/api/login", { method: "POST", body: { username: f.get("username"), password: f.get("password") } });
    state.token = token;
    localStorage.setItem("sn_token", token);
    await boot();
  } catch (err) { $("#login-error").textContent = err.message; }
});

$("#logout").addEventListener("click", () => logout());
async function logout(silent) {
  if (!silent) await api("/api/logout", { method: "POST" }).catch(() => {});
  stopPoll();
  state.token = null; state.me = null; state.course = null;
  localStorage.removeItem("sn_token");
  if (!$("#app-view").classList.contains("hidden")) return location.reload();
  $("#login-view").classList.remove("hidden");
}

$("#menu-btn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

async function boot() {
  if (!state.token) return logout(true);
  const { user, years } = await api("/api/me");
  state.me = user; state.years = years;
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#me-name").textContent = user.name;
  $("#me-role").textContent = { student: "סטודנט/ית", lecturer: "מרצה", admin: "מנהל/ת מערכת" }[user.role];
  if (user.role === "admin") return openAdmin(localStorage.getItem("sn_admin") || "courses");
  renderTree();
  const saved = JSON.parse(localStorage.getItem("sn_last") || "null");
  const all = years.flatMap((y) => y.courses.map((c) => ({ ...c, year: y.label })));
  const c = all.find((x) => saved && x.id === saved.course) ;
  if (c) openCourse(c, saved.tab);
}

// ---------------------------------------------------------------- sidebar tree (שנים -> קורסים)
function renderTree() {
  const tree = $("#tree");
  tree.replaceChildren();
  if (!state.years.length) tree.append(h("p", { class: "muted small" }, "אין קורסים משויכים."));
  const lastYear = state.years.length - 1;
  state.years.forEach((y, i) => {
    tree.append(h("details", { class: "year", open: i === lastYear || null },
      h("summary", {}, y.label, h("span", { class: "muted small" }, `  (${y.courses.length})`)),
      y.courses.map((c) => h("button", {
        class: "course-link" + (state.course && state.course.id === c.id ? " active" : ""),
        "data-id": c.id,
        onclick: () => { openCourse({ ...c, year: y.label }); $("#sidebar").classList.remove("open"); },
      }, c.name, " ", h("span", { class: "code" }, c.code)))
    ));
  });
}

// ---------------------------------------------------------------- course view
function tabsFor() {
  return state.me.role === "student"
    ? [["notes", "📝 הסיכומים שלי"], ["lecturer", "👨‍🏫 צ'אט עם המרצה"], ["class", "👥 צ'אט הקורס"]]
    : [["threads", "💬 שיחות עם סטודנטים"]];
}

async function openCourse(c, tab) {
  stopPoll();
  state.course = c;
  document.querySelectorAll(".course-link").forEach((b) => b.classList.toggle("active", +b.dataset.id === c.id));
  $("#crumb").textContent = c.year;
  $("#course-title").textContent = c.name;
  $("#course-sub").textContent = `${c.code} · ${c.lecturer_name}`;
  const tabs = tabsFor();
  const tabsEl = $("#tabs");
  tabsEl.classList.remove("hidden");
  tabsEl.replaceChildren(...tabs.map(([k, label]) => h("button", { class: "tab", "data-tab": k, onclick: () => switchTab(k) }, label)));
  switchTab(tabs.some(([k]) => k === tab) ? tab : tabs[0][0]);
  api(`/api/courses/${c.id}`).then((d) => {
    if (state.course?.id === c.id) $("#course-sub").textContent = `${c.code} · ${d.lecturer_name} · ${d.student_count} סטודנטים`;
  }).catch(() => {});
}

function switchTab(k) {
  stopPoll();
  state.tab = k;
  localStorage.setItem("sn_last", JSON.stringify({ course: state.course.id, tab: k }));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === k));
  const panel = $("#panel");
  panel.replaceChildren();
  panel.style.display = ""; panel.style.flexDirection = "";
  ({ notes: renderNotes, lecturer: renderLecturerChat, class: renderClassChat, threads: renderThreads })[k](panel);
}

// ---------------------------------------------------------------- notes (מקום אישי לכל סטודנט)
async function renderNotes(panel) {
  const cid = state.course.id;
  const { notes, files } = await api(`/api/courses/${cid}/notes`);
  if (state.course.id !== cid || state.tab !== "notes") return;

  const fileInput = h("input", { type: "file", multiple: true, class: "hidden", onchange: (e) => upload(e.target.files) });
  const drop = h("div", { class: "dropzone" }, "גררו לכאן קבצים (PDF, Word, תמונות…) או ",
    h("button", { class: "btn sm", onclick: () => fileInput.click() }, "בחרו קבצים"), fileInput);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files); });

  panel.replaceChildren(
    h("div", { class: "section-head" },
      h("h3", {}, `סיכומים שכתבתי (${notes.length})`),
      h("button", { class: "btn primary", onclick: () => openEditor(null) }, "＋ סיכום חדש")),
    notes.length
      ? h("div", { class: "grid" }, notes.map((n) => h("div", { class: "card", onclick: () => openEditor(n) },
          h("h4", {}, n.title), h("div", { class: "preview" }, n.content || "—"),
          h("div", { class: "muted small" }, "עודכן " + fmtDate(n.updated_at)))))
      : h("p", { class: "muted" }, "עוד לא כתבת סיכומים בקורס הזה."),
    h("div", { class: "section-head" }, h("h3", {}, `קבצים שהעליתי (${files.length})`)),
    drop,
    h("div", { class: "file-list" }, files.map((f) => h("div", { class: "file-row" },
      h("span", {}, fileIcon(f.mime)),
      h("span", { class: "name", title: f.filename }, f.filename),
      h("span", { class: "muted small" }, fmtSize(f.size) + " · " + fmtDate(f.created_at)),
      h("button", { class: "btn sm", onclick: () => download(f) }, "הורדה"),
      h("button", { class: "btn sm danger", onclick: async () => {
        if (!confirm(`למחוק את "${f.filename}"?`)) return;
        await api(`/api/files/${f.id}`, { method: "DELETE" }); renderNotes(panel);
      } }, "מחיקה"))))
  );

  async function upload(list) {
    for (const file of list) {
      if (file.size > 15 * 1024 * 1024) { alert(`"${file.name}" גדול מ-15MB`); continue; }
      drop.firstChild.textContent = `מעלה את ${file.name}… `;
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1] || "");
        r.onerror = rej; r.readAsDataURL(file);
      });
      try { await api(`/api/courses/${cid}/files`, { method: "POST", body: { filename: file.name, data } }); }
      catch (e) { alert(e.message); }
    }
    renderNotes(panel);
  }
}

async function download(f) {
  const res = await fetch(`/api/files/${f.id}`, { headers: { Authorization: "Bearer " + state.token } });
  if (!res.ok) return alert("ההורדה נכשלה");
  const url = URL.createObjectURL(await res.blob());
  const a = h("a", { href: url, download: f.filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function openEditor(note) {
  const panel = $("#panel");
  const title = h("input", { class: "title-input", placeholder: "כותרת הסיכום", value: note?.title || "" });
  const content = h("textarea", { placeholder: "כתבו כאן את הסיכום…" });
  content.value = note?.content || "";
  const status = h("span", { class: "muted small" });
  let id = note?.id || null;

  async function save() {
    status.textContent = "שומר…";
    try {
      if (id) await api(`/api/notes/${id}`, { method: "PUT", body: { title: title.value, content: content.value } });
      else id = (await api(`/api/courses/${state.course.id}/notes`, { method: "POST", body: { title: title.value, content: content.value } })).id;
      status.textContent = "נשמר ✓ " + new Date().toLocaleTimeString("he-IL", { timeStyle: "short" });
      delBtn.classList.remove("hidden");
    } catch (e) { status.textContent = e.message; }
  }
  let t;
  const autosave = () => { status.textContent = "שינויים לא שמורים"; clearTimeout(t); t = setTimeout(() => { if (id || title.value || content.value) save(); }, 1200); };
  title.addEventListener("input", autosave);
  content.addEventListener("input", autosave);

  const delBtn = h("button", { class: "btn danger" + (id ? "" : " hidden"), onclick: async () => {
    if (!confirm("למחוק את הסיכום?")) return;
    clearTimeout(t);
    await api(`/api/notes/${id}`, { method: "DELETE" }); switchTab("notes");
  } }, "מחיקה");

  panel.replaceChildren(h("div", { class: "editor" },
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: async () => { clearTimeout(t); if (status.textContent === "שינויים לא שמורים") await save(); switchTab("notes"); } }, "→ חזרה לסיכומים"),
      h("button", { class: "btn primary", onclick: () => { clearTimeout(t); save(); } }, "שמירה"),
      delBtn, status),
    title, content));
  (note ? content : title).focus();
}

// ---------------------------------------------------------------- chat
function stopPoll() { if (state.poll) clearInterval(state.poll); state.poll = null; }

function chatBox({ head, getUrl, postUrl, emptyText }) {
  const list = h("div", { class: "messages" }, h("p", { class: "muted small", style: "text-align:center" }, emptyText));
  const input = h("textarea", { placeholder: "כתבו הודעה… (Enter לשליחה, Shift+Enter לשורה חדשה)" });
  let last = 0, sending = false;

  async function load() {
    const { messages } = await api(getUrl + (getUrl.includes("?") ? "&" : "?") + "after=" + last);
    if (!messages.length) return;
    if (last === 0) list.replaceChildren();
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    for (const m of messages) {
      last = Math.max(last, m.id);
      const mine = m.sender_id === state.me.id;
      list.append(h("div", { class: "msg" + (mine ? " mine" : "") },
        h("div", { class: "meta" }, mine ? "אני" : m.sender_name,
          m.sender_role === "lecturer" && !mine ? h("span", { class: "badge" }, "מרצה") : null,
          " · " + fmtDate(m.created_at)),
        m.body));
    }
    if (atBottom || messages.some((m) => m.sender_id === state.me.id)) list.scrollTop = list.scrollHeight;
  }
  async function send() {
    const body = input.value.trim();
    if (!body || sending) return;
    sending = true;
    try { await api(postUrl, { method: "POST", body: { body } }); input.value = ""; await load(); }
    catch (e) { alert(e.message); }
    finally { sending = false; input.focus(); }
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

  const el = h("div", { class: "chat" }, h("div", { class: "chat-head" }, head), list,
    h("div", { class: "composer" }, input, h("button", { class: "btn primary", onclick: send }, "שליחה")));
  load().then(() => (list.scrollTop = list.scrollHeight)).catch(() => {});
  stopPoll();
  state.poll = setInterval(() => load().catch(() => {}), 3000);
  return el;
}

function fullHeight(panel) { panel.style.display = "flex"; panel.style.flexDirection = "column"; }

function renderLecturerChat(panel) {
  const c = state.course;
  fullHeight(panel);
  panel.append(h("div", { class: "chat-wrap" }, chatBox({
    head: h("span", {}, `שיחה פרטית עם ${c.lecturer_name} `, h("span", { class: "muted small" }, "· רק את/ה והמרצה רואים שיחה זו")),
    getUrl: `/api/courses/${c.id}/chat/lecturer`, postUrl: `/api/courses/${c.id}/chat/lecturer`,
    emptyText: "אין עדיין הודעות. אפשר לשאול את המרצה כל שאלה על הקורס.",
  })));
}

async function renderClassChat(panel) {
  const c = state.course;
  fullHeight(panel);
  const members = h("span", { class: "members" });
  panel.append(h("div", { class: "chat-wrap" }, chatBox({
    head: h("span", {}, `כל הסטודנטים ב${c.name} `, members),
    getUrl: `/api/courses/${c.id}/chat/class`, postUrl: `/api/courses/${c.id}/chat/class`,
    emptyText: "אין עדיין הודעות בקבוצת הקורס. התחילו את השיחה!",
  })));
  const { members: m } = await api(`/api/courses/${c.id}/members`);
  members.textContent = `· ${m.length} משתתפים: ${m.map((x) => x.name).join(", ")}`;
}

// מרצה: רשימת סטודנטים + שיחה פרטית עם כל אחד
async function renderThreads(panel) {
  const c = state.course;
  fullHeight(panel);
  const { threads } = await api(`/api/courses/${c.id}/chat/lecturer/threads`);
  if (state.course.id !== c.id) return;
  const side = h("div", { class: "threads" });
  const holder = h("div", { style: "flex:1;display:flex;min-width:0;min-height:0" },
    h("div", { class: "empty", style: "flex:1" }, "בחרו סטודנט/ית מהרשימה"));
  function select(t, row) {
    side.querySelectorAll(".thread").forEach((r) => r.classList.toggle("active", r === row));
    holder.replaceChildren(chatBox({
      head: `שיחה עם ${t.name}`,
      getUrl: `/api/courses/${c.id}/chat/lecturer?student_id=${t.id}`,
      postUrl: `/api/courses/${c.id}/chat/lecturer?student_id=${t.id}`,
      emptyText: "אין עדיין הודעות בשיחה זו.",
    }));
  }
  if (!threads.length) side.append(h("p", { class: "muted small", style: "padding:12px" }, "אין סטודנטים רשומים."));
  for (const t of threads) {
    const row = h("div", { class: "thread" }, h("div", {}, t.name), h("div", { class: "last" }, t.last_body || "אין הודעות"));
    row.addEventListener("click", () => select(t, row));
    side.append(row);
  }
  panel.replaceChildren(h("div", { class: "chat-wrap" }, side, holder));
}

// ---------------------------------------------------------------- admin
const ADMIN_SECTIONS = [["courses", "📚 קורסים ורישום"], ["years", "🗓️ שנים"], ["users", "👤 משתמשים"]];
const roleName = { student: "סטודנט/ית", lecturer: "מרצה", admin: "מנהל/ת" };

async function openAdmin(section) {
  stopPoll();
  localStorage.setItem("sn_admin", section);
  $("#tree").replaceChildren(...ADMIN_SECTIONS.map(([k, label]) => h("button", {
    class: "course-link" + (k === section ? " active" : ""), style: "margin-inline-start:0;width:100%",
    onclick: () => { openAdmin(k); $("#sidebar").classList.remove("open"); },
  }, label)));
  $("#tabs").classList.add("hidden");
  $("#crumb").textContent = "ניהול";
  $("#course-title").textContent = ADMIN_SECTIONS.find(([k]) => k === section)[1].slice(3);
  $("#course-sub").textContent = "";
  const panel = $("#panel");
  panel.style.display = ""; panel.style.flexDirection = "";
  let data;
  try { data = await api("/api/admin/overview"); } catch (e) { return panel.replaceChildren(h("p", { class: "error" }, e.message)); }
  const rerender = () => openAdmin(section);
  const act = (fn) => async (...a) => { try { await fn(...a); rerender(); } catch (e) { if (e.message !== "בוטל") alert(e.message); } };
  panel.replaceChildren(({ courses: adminCourses, years: adminYears, users: adminUsers })[section](data, act));
}

function field(label, input) { return h("label", { class: "field" }, h("span", {}, label), input); }
function select(name, options, value) {
  const s = h("select", { name }, options.map(([v, t]) => h("option", { value: v }, t)));
  if (value != null) s.value = String(value);
  return s;
}
function formValues(form) { return Object.fromEntries(new FormData(form)); }

function adminCourses({ years, courses, users }, act) {
  const lecturers = users.filter((u) => u.role === "lecturer");
  const students = users.filter((u) => u.role === "student");
  const yearOpts = years.map((y) => [y.id, y.label]);
  const lecOpts = lecturers.map((u) => [u.id, u.name]);

  const courseForm = (c, onSubmit, submitLabel) => {
    const f = h("form", { class: "admin-form" },
      field("שם הקורס", h("input", { name: "name", required: true, value: c?.name || "" })),
      field("קוד", h("input", { name: "code", value: c?.code || "", style: "max-width:120px" })),
      field("שנה", select("year_id", yearOpts, c?.year_id)),
      field("מרצה", select("lecturer_id", lecOpts, c?.lecturer_id)),
      h("button", { class: "btn primary", type: "submit" }, submitLabel));
    f.addEventListener("submit", (e) => { e.preventDefault(); onSubmit(formValues(f)); });
    return f;
  };

  const out = h("div", { class: "admin" });
  if (!years.length || !lecturers.length)
    out.append(h("p", { class: "notice" }, "כדי להוסיף קורס צריך קודם לפחות שנה אחת ומרצה אחד/ת (בלשוניות \"שנים\" ו\"משתמשים\")."));
  else out.append(h("h3", {}, "הוספת קורס"),
    courseForm(null, act((v) => api("/api/admin/courses", { method: "POST", body: v })), "＋ הוספה"));

  for (const y of years) {
    const list = courses.filter((c) => c.year_id === y.id);
    out.append(h("h3", {}, `${y.label} (${list.length})`));
    if (!list.length) { out.append(h("p", { class: "muted small" }, "אין קורסים בשנה זו.")); continue; }
    for (const c of list) {
      const extra = h("div");
      const row = h("div", { class: "admin-card" },
        h("div", { class: "admin-row" },
          h("div", { style: "flex:1;min-width:0" }, h("strong", {}, c.name), " ", h("span", { class: "muted small" }, c.code),
            h("div", { class: "muted small" }, `${c.lecturer_name} · ${c.student_ids.length} סטודנטים רשומים`)),
          h("button", { class: "btn sm", onclick: () => toggle("students") }, "👥 רישום סטודנטים"),
          h("button", { class: "btn sm", onclick: () => toggle("edit") }, "עריכה"),
          h("button", { class: "btn sm danger", onclick: act(async () => {
            if (!confirm(`למחוק את הקורס "${c.name}"?\nכל הסיכומים, הקבצים וההודעות של הקורס יימחקו לצמיתות.`)) throw new Error("בוטל");
            await api(`/api/admin/courses/${c.id}`, { method: "DELETE" });
          }) }, "מחיקה")),
        extra);
      let open = null;
      function toggle(kind) {
        if (open === kind) { extra.replaceChildren(); open = null; return; }
        open = kind;
        if (kind === "edit") return extra.replaceChildren(courseForm(c, act((v) => api(`/api/admin/courses/${c.id}`, { method: "PUT", body: v })), "שמירה"));
        const boxes = students.map((s) => h("label", { class: "check" },
          h("input", { type: "checkbox", value: s.id, checked: c.student_ids.includes(s.id) || null }), s.name,
          h("span", { class: "muted small" }, " " + s.username)));
        extra.replaceChildren(h("div", { class: "enroll" },
          students.length ? h("div", { class: "checks" }, boxes) : h("p", { class: "muted small" }, "אין סטודנטים במערכת."),
          h("div", { class: "admin-row" },
            h("button", { class: "btn sm", onclick: () => boxes.forEach((b) => (b.firstChild.checked = true)) }, "סמן הכל"),
            h("button", { class: "btn sm", onclick: () => boxes.forEach((b) => (b.firstChild.checked = false)) }, "נקה"),
            h("button", { class: "btn primary sm", onclick: act(() => api(`/api/admin/courses/${c.id}/enrollments`, {
              method: "PUT", body: { student_ids: boxes.filter((b) => b.firstChild.checked).map((b) => +b.firstChild.value) } })) }, "שמירת רישום"))));
      }
      out.append(row);
    }
  }
  return out;
}

function adminYears({ years }, act) {
  const f = h("form", { class: "admin-form" },
    field("שם השנה", h("input", { name: "label", required: true, placeholder: "לדוגמה: שנה ג׳ – תשפ״ז" })),
    h("button", { class: "btn primary", type: "submit" }, "＋ הוספה"));
  f.addEventListener("submit", (e) => { e.preventDefault(); act(() => api("/api/admin/years", { method: "POST", body: formValues(f) }))(); });
  return h("div", { class: "admin" }, h("h3", {}, "הוספת שנה"), f, h("h3", {}, `שנים (${years.length})`),
    years.map((y) => h("div", { class: "admin-card admin-row" },
      h("div", { style: "flex:1" }, h("strong", {}, y.label), h("div", { class: "muted small" }, `${y.course_count} קורסים`)),
      h("button", { class: "btn sm", onclick: act(async () => {
        const label = prompt("שם חדש לשנה:", y.label);
        if (!label) throw new Error("בוטל");
        await api(`/api/admin/years/${y.id}`, { method: "PUT", body: { label } });
      }) }, "שינוי שם"),
      h("button", { class: "btn sm danger", onclick: act(async () => {
        if (!confirm(`למחוק את "${y.label}"?`)) throw new Error("בוטל");
        await api(`/api/admin/years/${y.id}`, { method: "DELETE" });
      }) }, "מחיקה"))));
}

function adminUsers({ users }, act) {
  const f = h("form", { class: "admin-form" },
    field("שם מלא", h("input", { name: "name", required: true })),
    field("שם משתמש", h("input", { name: "username", required: true, dir: "ltr", placeholder: "english.only" })),
    field("תפקיד", select("role", [["student", "סטודנט/ית"], ["lecturer", "מרצה"], ["admin", "מנהל/ת"]])),
    field("סיסמה ראשונית", h("input", { name: "password", required: true, minlength: 4, dir: "ltr" })),
    h("button", { class: "btn primary", type: "submit" }, "＋ הוספה"));
  f.addEventListener("submit", (e) => { e.preventDefault(); act(() => api("/api/admin/users", { method: "POST", body: formValues(f) }))(); });
  const out = h("div", { class: "admin" }, h("h3", {}, "הוספת משתמש"), f);
  for (const role of ["student", "lecturer", "admin"]) {
    const list = users.filter((u) => u.role === role);
    out.append(h("h3", {}, `${{ student: "סטודנטים", lecturer: "מרצים", admin: "מנהלים" }[role]} (${list.length})`));
    for (const u of list) out.append(h("div", { class: "admin-card admin-row" },
      h("div", { style: "flex:1;min-width:0" }, h("strong", {}, u.name), " ", h("span", { class: "muted small", dir: "ltr" }, u.username)),
      h("button", { class: "btn sm", onclick: act(async () => {
        const name = prompt("שם מלא:", u.name);
        if (!name) throw new Error("בוטל");
        await api(`/api/admin/users/${u.id}`, { method: "PUT", body: { name } });
      }) }, "שינוי שם"),
      h("button", { class: "btn sm", onclick: act(async () => {
        const password = prompt(`סיסמה חדשה ל-${u.name}:`);
        if (!password) throw new Error("בוטל");
        await api(`/api/admin/users/${u.id}`, { method: "PUT", body: { password } });
        alert("הסיסמה עודכנה");
      }) }, "איפוס סיסמה"),
      u.id === state.me.id ? null : h("button", { class: "btn sm danger", onclick: act(async () => {
        if (!confirm(`למחוק את ${u.name}?\nהסיכומים, הקבצים וההודעות של המשתמש יימחקו לצמיתות.`)) throw new Error("בוטל");
        await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      }) }, "מחיקה")));
  }
  return out;
}

boot().catch(() => logout(true));
