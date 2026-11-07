#!/usr/bin/env python3
"""Student Notes – שרת אפליקציה (Python stdlib בלבד: http.server + sqlite3).

הרצה:  python3 server.py   ואז לפתוח http://localhost:8000
"""
import base64
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "student_notes.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "data", "uploads")
STATIC_DIR = os.path.join(BASE_DIR, "static")
PORT = int(os.environ.get("PORT", "8000"))
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB לקובץ

db_lock = threading.Lock()


# ---------------------------------------------------------------- DB
def connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def hash_pw(password, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${h}"


def check_pw(password, stored):
    salt, _ = stored.split("$", 1)
    return secrets.compare_digest(hash_pw(password, salt), stored)


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','lecturer','admin')), pw_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS years (
  id INTEGER PRIMARY KEY, label TEXT NOT NULL, sort INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT,
  year_id INTEGER NOT NULL REFERENCES years(id),
  lecturer_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS enrollments (
  student_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  PRIMARY KEY (student_id, course_id));
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  filename TEXT NOT NULL, stored_name TEXT NOT NULL, size INTEGER NOT NULL,
  mime TEXT, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id),
  channel TEXT NOT NULL CHECK (channel IN ('lecturer','class')),
  thread_student_id INTEGER REFERENCES users(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, created_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS idx_msg ON messages(course_id, channel, thread_student_id, id);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at REAL NOT NULL);
"""


def init_db():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    conn = connect()
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        seed(conn)
    migrate_admin(conn)
    conn.commit()
    return conn


def migrate_admin(conn):
    """מאגרים ישנים: מאפשר תפקיד admin ויוצר משתמש מנהל אם אין."""
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='users'").fetchone()[0]
    if "'admin'" not in sql:
        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(
            "BEGIN;"
            "CREATE TABLE users_new (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,"
            " role TEXT NOT NULL CHECK (role IN ('student','lecturer','admin')), pw_hash TEXT NOT NULL);"
            "INSERT INTO users_new SELECT * FROM users; DROP TABLE users;"
            "ALTER TABLE users_new RENAME TO users; COMMIT;")
        conn.execute("PRAGMA foreign_keys = ON")
    if not conn.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
        conn.execute("INSERT INTO users(username,name,role,pw_hash) VALUES (?,?,?,?)",
                     ("admin", "מנהל/ת מערכת", "admin", hash_pw("1234")))


def seed(conn):
    """נתוני דמו. סיסמה לכל המשתמשים: 1234"""
    pw = "1234"
    users = [
        ("dana", "דנה לוי", "student"),
        ("yossi", "יוסי כהן", "student"),
        ("noa", "נועה ברק", "student"),
        ("dr.katz", 'ד"ר אבי כץ', "lecturer"),
        ("prof.levin", "פרופ' מירב לוין", "lecturer"),
    ]
    ids = {}
    for u, n, r in users:
        cur = conn.execute("INSERT INTO users(username,name,role,pw_hash) VALUES (?,?,?,?)",
                           (u, n, r, hash_pw(pw)))
        ids[u] = cur.lastrowid
    y1 = conn.execute("INSERT INTO years(label,sort) VALUES ('שנה א׳ – תשפ״ה',1)").lastrowid
    y2 = conn.execute("INSERT INTO years(label,sort) VALUES ('שנה ב׳ – תשפ״ו',2)").lastrowid
    courses = [
        ("מבוא למדעי המחשב", "CS101", y1, "dr.katz"),
        ("חדו״א 1", "MATH101", y1, "prof.levin"),
        ("אלגברה לינארית", "MATH102", y1, "prof.levin"),
        ("מבני נתונים", "CS201", y2, "dr.katz"),
        ("הסתברות", "MATH201", y2, "prof.levin"),
        ("מערכות הפעלה", "CS202", y2, "dr.katz"),
    ]
    cids = {}
    for name, code, y, lec in courses:
        cids[code] = conn.execute(
            "INSERT INTO courses(name,code,year_id,lecturer_id) VALUES (?,?,?,?)",
            (name, code, y, ids[lec])).lastrowid
    enroll = {
        "dana": ["CS101", "MATH101", "MATH102", "CS201", "MATH201"],
        "yossi": ["CS101", "MATH101", "CS201", "CS202"],
        "noa": ["CS101", "MATH102", "CS201", "MATH201", "CS202"],
    }
    for s, codes in enroll.items():
        for c in codes:
            conn.execute("INSERT INTO enrollments VALUES (?,?)", (ids[s], cids[c]))
    now = time.time()
    conn.execute("INSERT INTO notes(student_id,course_id,title,content,created_at,updated_at) "
                 "VALUES (?,?,?,?,?,?)",
                 (ids["dana"], cids["CS201"], "הרצאה 1 – רשימות מקושרות",
                  "• רשימה מקושרת חד-כיוונית ודו-כיוונית\n• הכנסה בראש: O(1)\n• חיפוש: O(n)",
                  now, now))
    conn.execute("INSERT INTO messages(course_id,channel,thread_student_id,sender_id,body,created_at) "
                 "VALUES (?,?,?,?,?,?)",
                 (cids["CS201"], "class", None, ids["yossi"], "מישהו פתר כבר את תרגיל 2?", now))
    conn.execute("INSERT INTO messages(course_id,channel,thread_student_id,sender_id,body,created_at) "
                 "VALUES (?,?,?,?,?,?)",
                 (cids["CS201"], "lecturer", ids["dana"], ids["dr.katz"],
                  "שלום דנה, שעות הקבלה ביום ג׳ 12:00.", now))


DB = None


def q(sql, args=(), one=False):
    with db_lock:
        cur = DB.execute(sql, args)
        rows = cur.fetchall()
    rows = [dict(r) for r in rows]
    return (rows[0] if rows else None) if one else rows


def x(sql, args=()):
    with db_lock:
        cur = DB.execute(sql, args)
        DB.commit()
        return cur.lastrowid


# ---------------------------------------------------------------- access helpers
class HttpError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status, self.msg = status, msg


def course_access(user, course_id):
    """מחזיר את הקורס אם למשתמש יש גישה (סטודנט רשום / המרצה של הקורס)."""
    c = q("SELECT c.*, u.name AS lecturer_name FROM courses c JOIN users u ON u.id=c.lecturer_id "
          "WHERE c.id=?", (course_id,), one=True)
    if not c:
        raise HttpError(404, "הקורס לא נמצא")
    if user["role"] == "lecturer":
        if c["lecturer_id"] != user["id"]:
            raise HttpError(403, "אין לך גישה לקורס זה")
    else:
        if not q("SELECT 1 FROM enrollments WHERE student_id=? AND course_id=?",
                 (user["id"], course_id), one=True):
            raise HttpError(403, "אינך רשום/ה לקורס זה")
    return c


def require_student(user):
    if user["role"] != "student":
        raise HttpError(403, "פעולה זו זמינה לסטודנטים בלבד")


def msg_rows(rows):
    return [{"id": r["id"], "body": r["body"], "created_at": r["created_at"],
             "sender_id": r["sender_id"], "sender_name": r["sender_name"],
             "sender_role": r["sender_role"]} for r in rows]


# ---------------------------------------------------------------- API handlers
def api_login(user, body, **_):
    u = q("SELECT * FROM users WHERE username=?", ((body.get("username") or "").strip(),), one=True)
    if not u or not check_pw(body.get("password") or "", u["pw_hash"]):
        raise HttpError(401, "שם משתמש או סיסמה שגויים")
    token = secrets.token_urlsafe(32)
    x("INSERT INTO sessions VALUES (?,?,?)", (token, u["id"], time.time()))
    return {"token": token}


def api_logout(user, body, token=None, **_):
    x("DELETE FROM sessions WHERE token=?", (token,))
    return {"ok": True}


def api_me(user, body, **_):
    if user["role"] == "student":
        rows = q("SELECT c.id, c.name, c.code, c.year_id, u.name AS lecturer_name, "
                 "y.label AS year_label, y.sort FROM enrollments e "
                 "JOIN courses c ON c.id=e.course_id JOIN years y ON y.id=c.year_id "
                 "JOIN users u ON u.id=c.lecturer_id WHERE e.student_id=? ORDER BY y.sort, c.name",
                 (user["id"],))
    else:
        rows = q("SELECT c.id, c.name, c.code, c.year_id, u.name AS lecturer_name, "
                 "y.label AS year_label, y.sort FROM courses c JOIN years y ON y.id=c.year_id "
                 "JOIN users u ON u.id=c.lecturer_id WHERE c.lecturer_id=? ORDER BY y.sort, c.name",
                 (user["id"],))
    years = []
    for r in rows:
        if not years or years[-1]["id"] != r["year_id"]:
            years.append({"id": r["year_id"], "label": r["year_label"], "courses": []})
        years[-1]["courses"].append({"id": r["id"], "name": r["name"], "code": r["code"],
                                     "lecturer_name": r["lecturer_name"]})
    return {"user": {"id": user["id"], "name": user["name"], "role": user["role"],
                     "username": user["username"]}, "years": years}


def api_course(user, body, cid, **_):
    c = course_access(user, cid)
    count = q("SELECT COUNT(*) AS n FROM enrollments WHERE course_id=?", (cid,), one=True)["n"]
    return {"id": c["id"], "name": c["name"], "code": c["code"],
            "lecturer_name": c["lecturer_name"], "student_count": count}


# --- notes (פרטי לכל סטודנט)
def api_list_notes(user, body, cid, **_):
    require_student(user)
    course_access(user, cid)
    notes = q("SELECT id,title,content,created_at,updated_at FROM notes "
              "WHERE student_id=? AND course_id=? ORDER BY updated_at DESC", (user["id"], cid))
    files = q("SELECT id,filename,size,mime,created_at FROM files "
              "WHERE student_id=? AND course_id=? ORDER BY created_at DESC", (user["id"], cid))
    return {"notes": notes, "files": files}


def api_create_note(user, body, cid, **_):
    require_student(user)
    course_access(user, cid)
    title = (body.get("title") or "").strip() or "סיכום ללא כותרת"
    now = time.time()
    nid = x("INSERT INTO notes(student_id,course_id,title,content,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?)", (user["id"], cid, title[:200], body.get("content") or "", now, now))
    return {"id": nid}


def own_note(user, nid):
    n = q("SELECT * FROM notes WHERE id=?", (nid,), one=True)
    if not n or n["student_id"] != user["id"]:
        raise HttpError(404, "הסיכום לא נמצא")
    return n


def api_update_note(user, body, nid, **_):
    n = own_note(user, nid)
    title = (body.get("title") if "title" in body else n["title"]).strip() or "סיכום ללא כותרת"
    content = body.get("content") if "content" in body else n["content"]
    x("UPDATE notes SET title=?, content=?, updated_at=? WHERE id=?",
      (title[:200], content, time.time(), nid))
    return {"ok": True}


def api_delete_note(user, body, nid, **_):
    own_note(user, nid)
    x("DELETE FROM notes WHERE id=?", (nid,))
    return {"ok": True}


# --- files
def api_upload(user, body, cid, **_):
    require_student(user)
    course_access(user, cid)
    name = os.path.basename((body.get("filename") or "").replace("\\", "/")).strip() or "file"
    try:
        data = base64.b64decode(body.get("data") or "", validate=True)
    except Exception:
        raise HttpError(400, "קובץ לא תקין")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HttpError(413, "הקובץ גדול מדי (מקסימום 15MB)")
    ext = os.path.splitext(name)[1][:10]
    stored = uuid.uuid4().hex + re.sub(r"[^A-Za-z0-9.]", "", ext)
    with open(os.path.join(UPLOAD_DIR, stored), "wb") as f:
        f.write(data)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    fid = x("INSERT INTO files(student_id,course_id,filename,stored_name,size,mime,created_at) "
            "VALUES (?,?,?,?,?,?,?)", (user["id"], cid, name[:200], stored, len(data), mime, time.time()))
    return {"id": fid}


def own_file(user, fid):
    f = q("SELECT * FROM files WHERE id=?", (fid,), one=True)
    if not f or f["student_id"] != user["id"]:
        raise HttpError(404, "הקובץ לא נמצא")
    return f


def api_delete_file(user, body, fid, **_):
    f = own_file(user, fid)
    x("DELETE FROM files WHERE id=?", (fid,))
    try:
        os.remove(os.path.join(UPLOAD_DIR, f["stored_name"]))
    except FileNotFoundError:
        pass
    return {"ok": True}


# --- chat: מרצה <-> סטודנט (שיחה פרטית לכל סטודנט)
def thread_student_for(user, cid, query):
    if user["role"] == "student":
        return user["id"]
    sid = int((query.get("student_id") or ["0"])[0] or 0)
    if not q("SELECT 1 FROM enrollments WHERE student_id=? AND course_id=?", (sid, cid), one=True):
        raise HttpError(400, "יש לבחור סטודנט/ית רשום/ה לקורס")
    return sid


def api_lecturer_chat_get(user, body, cid, query, **_):
    course_access(user, cid)
    sid = thread_student_for(user, cid, query)
    after = int((query.get("after") or ["0"])[0] or 0)
    rows = q("SELECT m.*, u.name AS sender_name, u.role AS sender_role FROM messages m "
             "JOIN users u ON u.id=m.sender_id WHERE m.course_id=? AND m.channel='lecturer' "
             "AND m.thread_student_id=? AND m.id>? ORDER BY m.id", (cid, sid, after))
    return {"messages": msg_rows(rows)}


def api_lecturer_chat_post(user, body, cid, query, **_):
    course_access(user, cid)
    sid = thread_student_for(user, cid, query)
    text = (body.get("body") or "").strip()
    if not text:
        raise HttpError(400, "ההודעה ריקה")
    mid = x("INSERT INTO messages(course_id,channel,thread_student_id,sender_id,body,created_at) "
            "VALUES (?,?,?,?,?,?)", (cid, "lecturer", sid, user["id"], text[:4000], time.time()))
    return {"id": mid}


def api_lecturer_threads(user, body, cid, **_):
    """למרצה: רשימת כל הסטודנטים בקורס + ההודעה האחרונה בכל שיחה."""
    if user["role"] != "lecturer":
        raise HttpError(403, "למרצים בלבד")
    course_access(user, cid)
    rows = q("""SELECT u.id, u.name,
                (SELECT body FROM messages m WHERE m.course_id=e.course_id AND m.channel='lecturer'
                   AND m.thread_student_id=u.id ORDER BY m.id DESC LIMIT 1) AS last_body,
                (SELECT MAX(id) FROM messages m WHERE m.course_id=e.course_id AND m.channel='lecturer'
                   AND m.thread_student_id=u.id) AS last_id
              FROM enrollments e JOIN users u ON u.id=e.student_id
              WHERE e.course_id=? ORDER BY last_id IS NULL, last_id DESC, u.name""", (cid,))
    return {"threads": rows}


# --- chat: כל הסטודנטים בקורס
def api_class_chat_get(user, body, cid, query, **_):
    require_student(user)
    course_access(user, cid)
    after = int((query.get("after") or ["0"])[0] or 0)
    rows = q("SELECT m.*, u.name AS sender_name, u.role AS sender_role FROM messages m "
             "JOIN users u ON u.id=m.sender_id WHERE m.course_id=? AND m.channel='class' "
             "AND m.id>? ORDER BY m.id", (cid, after))
    return {"messages": msg_rows(rows)}


def api_class_chat_post(user, body, cid, **_):
    require_student(user)
    course_access(user, cid)
    text = (body.get("body") or "").strip()
    if not text:
        raise HttpError(400, "ההודעה ריקה")
    mid = x("INSERT INTO messages(course_id,channel,thread_student_id,sender_id,body,created_at) "
            "VALUES (?,?,?,?,?,?)", (cid, "class", None, user["id"], text[:4000], time.time()))
    return {"id": mid}


def api_class_members(user, body, cid, **_):
    require_student(user)
    course_access(user, cid)
    return {"members": q("SELECT u.id, u.name FROM enrollments e JOIN users u ON u.id=e.student_id "
                         "WHERE e.course_id=? ORDER BY u.name", (cid,))}


# ---------------------------------------------------------------- admin (ניהול שנים, קורסים, משתמשים, רישום)
def require_admin(user):
    if user["role"] != "admin":
        raise HttpError(403, "למנהלי מערכת בלבד")


def clean(body, key, required=True, maxlen=200):
    v = (body.get(key) or "").strip()[:maxlen]
    if required and not v:
        raise HttpError(400, "חסר שדה חובה")
    return v


def api_admin_overview(user, body, **_):
    require_admin(user)
    years = q("SELECT y.id, y.label, y.sort, (SELECT COUNT(*) FROM courses c WHERE c.year_id=y.id) AS course_count "
              "FROM years y ORDER BY y.sort, y.id")
    courses = q("SELECT c.id, c.name, c.code, c.year_id, c.lecturer_id, u.name AS lecturer_name "
                "FROM courses c JOIN users u ON u.id=c.lecturer_id ORDER BY c.name")
    enr = q("SELECT student_id, course_id FROM enrollments")
    for c in courses:
        c["student_ids"] = [e["student_id"] for e in enr if e["course_id"] == c["id"]]
    users = q("SELECT id, username, name, role FROM users ORDER BY role, name")
    return {"years": years, "courses": courses, "users": users}


def api_admin_year_create(user, body, **_):
    require_admin(user)
    sort = (q("SELECT MAX(sort) AS m FROM years", one=True)["m"] or 0) + 1
    return {"id": x("INSERT INTO years(label,sort) VALUES (?,?)", (clean(body, "label"), sort))}


def api_admin_year_update(user, body, yid, **_):
    require_admin(user)
    x("UPDATE years SET label=? WHERE id=?", (clean(body, "label"), yid))
    return {"ok": True}


def api_admin_year_delete(user, body, yid, **_):
    require_admin(user)
    if q("SELECT 1 FROM courses WHERE year_id=?", (yid,), one=True):
        raise HttpError(400, "אי אפשר למחוק שנה שיש בה קורסים. מחקו או העבירו את הקורסים קודם.")
    x("DELETE FROM years WHERE id=?", (yid,))
    return {"ok": True}


def course_fields(body):
    year_id, lec_id = int(body.get("year_id") or 0), int(body.get("lecturer_id") or 0)
    if not q("SELECT 1 FROM years WHERE id=?", (year_id,), one=True):
        raise HttpError(400, "יש לבחור שנה")
    if not q("SELECT 1 FROM users WHERE id=? AND role='lecturer'", (lec_id,), one=True):
        raise HttpError(400, "יש לבחור מרצה")
    return clean(body, "name"), clean(body, "code", required=False, maxlen=30), year_id, lec_id


def api_admin_course_create(user, body, **_):
    require_admin(user)
    return {"id": x("INSERT INTO courses(name,code,year_id,lecturer_id) VALUES (?,?,?,?)", course_fields(body))}


def api_admin_course_update(user, body, cid, **_):
    require_admin(user)
    x("UPDATE courses SET name=?, code=?, year_id=?, lecturer_id=? WHERE id=?", (*course_fields(body), cid))
    return {"ok": True}


def remove_files(where, args):
    for f in q("SELECT stored_name FROM files WHERE " + where, args):
        try:
            os.remove(os.path.join(UPLOAD_DIR, f["stored_name"]))
        except FileNotFoundError:
            pass


def api_admin_course_delete(user, body, cid, **_):
    require_admin(user)
    remove_files("course_id=?", (cid,))
    with db_lock:
        for t in ("messages", "files", "notes", "enrollments"):
            DB.execute(f"DELETE FROM {t} WHERE course_id=?", (cid,))
        DB.execute("DELETE FROM courses WHERE id=?", (cid,))
        DB.commit()
    return {"ok": True}


def api_admin_enrollments(user, body, cid, **_):
    """קובע את רשימת הסטודנטים הרשומים לקורס. הסיכומים של סטודנט שהוסר נשמרים ויחזרו אם יירשם שוב."""
    require_admin(user)
    if not q("SELECT 1 FROM courses WHERE id=?", (cid,), one=True):
        raise HttpError(404, "הקורס לא נמצא")
    ids = {int(i) for i in body.get("student_ids") or []}
    valid = {r["id"] for r in q("SELECT id FROM users WHERE role='student'")}
    if ids - valid:
        raise HttpError(400, "משתמש לא תקין ברשימה")
    with db_lock:
        DB.execute("DELETE FROM enrollments WHERE course_id=?", (cid,))
        DB.executemany("INSERT INTO enrollments VALUES (?,?)", [(i, cid) for i in ids])
        DB.commit()
    return {"ok": True}


def api_admin_user_create(user, body, **_):
    require_admin(user)
    role = body.get("role")
    if role not in ("student", "lecturer", "admin"):
        raise HttpError(400, "תפקיד לא תקין")
    username = clean(body, "username", maxlen=50).lower()
    if not re.fullmatch(r"[a-z0-9._-]+", username):
        raise HttpError(400, "שם משתמש: אותיות באנגלית, ספרות, נקודה, מקף או קו תחתון בלבד")
    pw = body.get("password") or ""
    if len(pw) < 4:
        raise HttpError(400, "סיסמה של 4 תווים לפחות")
    if q("SELECT 1 FROM users WHERE username=?", (username,), one=True):
        raise HttpError(400, "שם המשתמש תפוס")
    return {"id": x("INSERT INTO users(username,name,role,pw_hash) VALUES (?,?,?,?)",
                    (username, clean(body, "name"), role, hash_pw(pw)))}


def api_admin_user_update(user, body, uid, **_):
    require_admin(user)
    if not q("SELECT 1 FROM users WHERE id=?", (uid,), one=True):
        raise HttpError(404, "המשתמש לא נמצא")
    if "name" in body:
        x("UPDATE users SET name=? WHERE id=?", (clean(body, "name"), uid))
    if "password" in body:
        if len(body["password"] or "") < 4:
            raise HttpError(400, "סיסמה של 4 תווים לפחות")
        x("UPDATE users SET pw_hash=? WHERE id=?", (hash_pw(body["password"]), uid))
        x("DELETE FROM sessions WHERE user_id=? AND user_id<>?", (uid, user["id"]))
    return {"ok": True}


def api_admin_user_delete(user, body, uid, **_):
    require_admin(user)
    if uid == user["id"]:
        raise HttpError(400, "אי אפשר למחוק את המשתמש שלך")
    if q("SELECT 1 FROM courses WHERE lecturer_id=?", (uid,), one=True):
        raise HttpError(400, "המרצה משויך/ת לקורסים. החליפו מרצה בקורסים האלה קודם.")
    remove_files("student_id=?", (uid,))
    with db_lock:
        DB.execute("DELETE FROM messages WHERE sender_id=? OR thread_student_id=?", (uid, uid))
        for t, col in (("files", "student_id"), ("notes", "student_id"),
                       ("enrollments", "student_id"), ("sessions", "user_id")):
            DB.execute(f"DELETE FROM {t} WHERE {col}=?", (uid,))
        DB.execute("DELETE FROM users WHERE id=?", (uid,))
        DB.commit()
    return {"ok": True}


ROUTES = [
    ("POST", r"/api/login", api_login, False),
    ("POST", r"/api/logout", api_logout, True),
    ("GET", r"/api/me", api_me, True),
    ("GET", r"/api/courses/(?P<cid>\d+)", api_course, True),
    ("GET", r"/api/courses/(?P<cid>\d+)/notes", api_list_notes, True),
    ("POST", r"/api/courses/(?P<cid>\d+)/notes", api_create_note, True),
    ("PUT", r"/api/notes/(?P<nid>\d+)", api_update_note, True),
    ("DELETE", r"/api/notes/(?P<nid>\d+)", api_delete_note, True),
    ("POST", r"/api/courses/(?P<cid>\d+)/files", api_upload, True),
    ("DELETE", r"/api/files/(?P<fid>\d+)", api_delete_file, True),
    ("GET", r"/api/courses/(?P<cid>\d+)/chat/lecturer", api_lecturer_chat_get, True),
    ("POST", r"/api/courses/(?P<cid>\d+)/chat/lecturer", api_lecturer_chat_post, True),
    ("GET", r"/api/courses/(?P<cid>\d+)/chat/lecturer/threads", api_lecturer_threads, True),
    ("GET", r"/api/courses/(?P<cid>\d+)/chat/class", api_class_chat_get, True),
    ("POST", r"/api/courses/(?P<cid>\d+)/chat/class", api_class_chat_post, True),
    ("GET", r"/api/courses/(?P<cid>\d+)/members", api_class_members, True),
    ("GET", r"/api/admin/overview", api_admin_overview, True),
    ("POST", r"/api/admin/years", api_admin_year_create, True),
    ("PUT", r"/api/admin/years/(?P<yid>\d+)", api_admin_year_update, True),
    ("DELETE", r"/api/admin/years/(?P<yid>\d+)", api_admin_year_delete, True),
    ("POST", r"/api/admin/courses", api_admin_course_create, True),
    ("PUT", r"/api/admin/courses/(?P<cid>\d+)", api_admin_course_update, True),
    ("DELETE", r"/api/admin/courses/(?P<cid>\d+)", api_admin_course_delete, True),
    ("PUT", r"/api/admin/courses/(?P<cid>\d+)/enrollments", api_admin_enrollments, True),
    ("POST", r"/api/admin/users", api_admin_user_create, True),
    ("PUT", r"/api/admin/users/(?P<uid>\d+)", api_admin_user_update, True),
    ("DELETE", r"/api/admin/users/(?P<uid>\d+)", api_admin_user_delete, True),
]
ROUTES = [(m, re.compile("^" + p + "$"), fn, auth) for m, p, fn, auth in ROUTES]


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "StudentNotes/1.0"

    def log_message(self, fmt, *args):
        pass

    def send_json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def auth_user(self):
        h = self.headers.get("Authorization", "")
        token = h[7:] if h.startswith("Bearer ") else None
        if not token:
            return None, None
        u = q("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?",
              (token,), one=True)
        return u, token

    def handle_any(self, method):
        url = urlparse(self.path)
        path = url.path
        try:
            if path.startswith("/api/files/") and method == "GET":
                return self.download(path)
            if path.startswith("/api/"):
                return self.api(method, path, parse_qs(url.query))
            if method != "GET":
                raise HttpError(405, "Method not allowed")
            return self.static(path)
        except HttpError as e:
            self.send_json(e.status, {"error": e.msg})
        except Exception as e:  # noqa
            import traceback
            traceback.print_exc()
            self.send_json(500, {"error": "שגיאת שרת"})

    def api(self, method, path, query):
        for m, rx, fn, needs_auth in ROUTES:
            mt = rx.match(path)
            if mt and m == method:
                user, token = self.auth_user()
                if needs_auth and not user:
                    raise HttpError(401, "יש להתחבר מחדש")
                body = {}
                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_UPLOAD_BYTES * 1.4 + 10000:
                    raise HttpError(413, "הבקשה גדולה מדי")
                if length:
                    try:
                        body = json.loads(self.rfile.read(length) or b"{}")
                    except ValueError:
                        raise HttpError(400, "JSON לא תקין")
                kwargs = {k: int(v) for k, v in mt.groupdict().items()}
                return self.send_json(200, fn(user, body, query=query, token=token, **kwargs))
        raise HttpError(404, "לא נמצא")

    def download(self, path):
        mt = re.match(r"^/api/files/(\d+)$", path)
        user, _ = self.auth_user()
        if not mt or not user:
            raise HttpError(401, "יש להתחבר מחדש")
        f = own_file(user, int(mt.group(1)))
        fp = os.path.join(UPLOAD_DIR, f["stored_name"])
        if not os.path.exists(fp):
            raise HttpError(404, "הקובץ לא נמצא")
        with open(fp, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", f["mime"] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(f["filename"]))
        self.end_headers()
        self.wfile.write(data)

    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        fp = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
        if not fp.startswith(STATIC_DIR) or not os.path.isfile(fp):
            fp = os.path.join(STATIC_DIR, "index.html")
        with open(fp, "rb") as fh:
            data = fh.read()
        ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self): self.handle_any("GET")
    def do_POST(self): self.handle_any("POST")
    def do_PUT(self): self.handle_any("PUT")
    def do_DELETE(self): self.handle_any("DELETE")


if __name__ == "__main__":
    DB = init_db()
    print(f"Student Notes פועל: http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
