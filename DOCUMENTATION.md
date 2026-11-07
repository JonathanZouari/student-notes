# Student Notes – App Documentation

Student Notes issssssssssssssss a web app where students keep their course notes and talk with their lecturers and classmates. The interface is in Hebrew (right-to-left).

It runs on **Python 3 only**: the server uses the standard library (`http.server` + `sqlite3`), and the front end is plain HTML, CSS and JavaScript. Nothing needs to be installed.

---

## Contents
1. [Features](#features)
2. [User roles](#user-roles)
3. [Getting started](#getting-started)
4. [Using the app](#using-the-app)
5. [Project structure](#project-structure)
6. [Data model](#data-model)
7. [API reference](#api-reference)
8. [Security and privacy](#security-and-privacy)
9. [Configuration](#configuration)
10. [Limitations and next steps](#limitations-and-next-steps)

---

## Features

### Personal notes library
- Every student has their own library, organized as **year → courses**. Each year shows only the courses the student is enrolled in that year.
- In each course, the student can:
  - **Write notes** in a built-in editor that saves automatically while typing.
  - **Upload files** (PDF, Word, images and more, up to 15 MB each) by dragging them in or choosing them, and later download or delete them.
- Notes and files are **private**: only the student who created them can see them.

### Chat with the lecturer
- Each student has a **private conversation** with the lecturer of each course. Only that student and the lecturer can see it.
- The lecturer sees a list of all students in the course, sorted by latest activity, and can open the conversation with any of them.

### Course group chat
- Each course has a **shared chat for all enrolled students**. The lecturer is not part of it.
- The chat header shows who the participants are.

Both chats show new messages within about 3 seconds, without refreshing the page.

### Admin screen
- **Years:** add, rename, delete (only when the year has no courses).
- **Courses:** add, edit (name, code, year, lecturer), delete.
- **Enrollments:** pick which students are enrolled in each course with checkboxes.
- **Users:** add students, lecturers and admins; rename; reset passwords; delete.

---

## User roles

| Role | What they can do |
|---|---|
| **Student** | Own notes and files per enrolled course, private chat with each lecturer, group chat per course |
| **Lecturer** | See their courses by year, and chat privately with each enrolled student |
| **Admin** | Manage years, courses, users and enrollments. Cannot read students' notes or chats |

---

## Getting started

### Run the app
```bash
python3 server.py
```
Then open **http://localhost:8000** in a browser.

On first run the app creates `data/student_notes.db` and fills it with demo data.

### Demo users
All demo users have the password **`1234`**.

| Username | Name | Role |
|---|---|---|
| `dana` | דנה לוי | Student |
| `yossi` | יוסי כהן | Student |
| `noa` | נועה ברק | Student |
| `dr.katz` | ד"ר אבי כץ | Lecturer |
| `prof.levin` | פרופ' מירב לוין | Lecturer |
| `admin` | מנהל/ת מערכת | Admin |

> Change the `admin` password from the **Users** screen before using the app with real people.

### Reset to demo data
Stop the server, delete the `data/` folder, and start it again.

---

## Using the app

### As a student
1. Log in. The sidebar shows your years. Open a year and choose a course.
2. **"הסיכומים שלי" (My notes):**
   - Click **"＋ סיכום חדש"** to write a new note. It saves automatically.
   - Drag files onto the upload area, or click **"בחרו קבצים"**.
3. **"צ'אט עם המרצה" (Chat with the lecturer):** your private conversation with the course lecturer.
4. **"צ'אט הקורס" (Course chat):** the group conversation with all students in the course.

In both chats, press **Enter** to send and **Shift+Enter** for a new line.

### As a lecturer
1. Log in and choose a course from the sidebar.
2. On the right is the list of enrolled students. Click a student to open your conversation with them.

### As an admin
1. Log in as `admin`. The sidebar shows the three management screens.
2. Typical order when setting up a new year:
   1. **שנים (Years):** add the year.
   2. **משתמשים (Users):** add any new students and lecturers.
   3. **קורסים ורישום (Courses):** add the courses, choosing the year and lecturer.
   4. On each course, click **"👥 רישום סטודנטים"**, tick the students and click **"שמירת רישום"**.

---

## Project structure

```
.
├── server.py          # HTTP server, database, API and access rules
├── static/
│   ├── index.html     # Page layout: login screen and app shell
│   ├── app.js         # Front-end logic: library, notes, chats, admin screens
│   └── style.css      # Styles, including dark mode and mobile layout
├── data/              # Created at runtime, not committed (see .gitignore)
│   ├── student_notes.db
│   └── uploads/       # Uploaded files, stored under random names
├── README.md          # Short overview (Hebrew)
└── DOCUMENTATION.md   # This file
```

---

## Data model

SQLite database, `data/student_notes.db`:

| Table | Purpose | Main columns |
|---|---|---|
| `users` | All users | `username`, `name`, `role` (`student` / `lecturer` / `admin`), `pw_hash` |
| `years` | Academic years | `label`, `sort` |
| `courses` | Courses | `name`, `code`, `year_id`, `lecturer_id` |
| `enrollments` | Which student is in which course | `student_id`, `course_id` |
| `notes` | Written notes | `student_id`, `course_id`, `title`, `content`, `created_at`, `updated_at` |
| `files` | Uploaded files | `student_id`, `course_id`, `filename`, `stored_name`, `size`, `mime` |
| `messages` | Chat messages | `course_id`, `channel` (`lecturer` / `class`), `thread_student_id`, `sender_id`, `body` |
| `sessions` | Login tokens | `token`, `user_id` |

In the `messages` table:
- `channel = 'lecturer'`: a private conversation. `thread_student_id` is the student the conversation belongs to.
- `channel = 'class'`: the course group chat. `thread_student_id` is empty.

Databases created by the first version (without the admin role) are upgraded automatically when the server starts.

---

## API reference

All endpoints return JSON. Except for login, every request needs the header:
```
Authorization: Bearer <token>
```

### Auth and profile
| Method | Path | Description |
|---|---|---|
| POST | `/api/login` | Body `{username, password}` → `{token}` |
| POST | `/api/logout` | Ends the current session |
| GET | `/api/me` | Current user, plus their years and courses |

### Courses, notes and files (students)
| Method | Path | Description |
|---|---|---|
| GET | `/api/courses/{id}` | Course details and student count |
| GET | `/api/courses/{id}/notes` | My notes and files in this course |
| POST | `/api/courses/{id}/notes` | Create a note `{title, content}` |
| PUT | `/api/notes/{id}` | Update a note `{title?, content?}` |
| DELETE | `/api/notes/{id}` | Delete a note |
| POST | `/api/courses/{id}/files` | Upload a file `{filename, data}` (data is base64) |
| GET | `/api/files/{id}` | Download a file |
| DELETE | `/api/files/{id}` | Delete a file |

### Chats
| Method | Path | Description |
|---|---|---|
| GET | `/api/courses/{id}/chat/lecturer?after={msgId}` | Private chat messages. Lecturers add `&student_id=` |
| POST | `/api/courses/{id}/chat/lecturer` | Send a private message `{body}`. Lecturers add `?student_id=` |
| GET | `/api/courses/{id}/chat/lecturer/threads` | Lecturer only: students and their last message |
| GET | `/api/courses/{id}/chat/class?after={msgId}` | Course group messages (students only) |
| POST | `/api/courses/{id}/chat/class` | Send to the course group `{body}` |
| GET | `/api/courses/{id}/members` | Students enrolled in the course |

`after` returns only messages newer than that ID. The app uses it to poll every 3 seconds.

### Admin
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/overview` | All years, courses (with enrolled student IDs) and users |
| POST | `/api/admin/years` | Add a year `{label}` |
| PUT | `/api/admin/years/{id}` | Rename a year `{label}` |
| DELETE | `/api/admin/years/{id}` | Delete a year (must have no courses) |
| POST | `/api/admin/courses` | Add a course `{name, code, year_id, lecturer_id}` |
| PUT | `/api/admin/courses/{id}` | Edit a course (same fields) |
| DELETE | `/api/admin/courses/{id}` | Delete a course and all its notes, files and messages |
| PUT | `/api/admin/courses/{id}/enrollments` | Set enrolled students `{student_ids: [...]}` |
| POST | `/api/admin/users` | Add a user `{name, username, role, password}` |
| PUT | `/api/admin/users/{id}` | Rename `{name}` and/or reset password `{password}` |
| DELETE | `/api/admin/users/{id}` | Delete a user and their notes, files and messages |

Errors return an HTTP error status with `{"error": "<message in Hebrew>"}`.

---

## Security and privacy

- **Passwords** are stored as salted PBKDF2-SHA256 hashes (100,000 iterations).
- **Access rules are checked on the server** for every request:
  - Students can only reach courses they're enrolled in, and only their own notes and files.
  - Lecturers can only reach courses they teach.
  - Private chats are visible only to the student and the course lecturer.
  - Admins can't open course content.
- **Resetting a password** signs the user out of all their sessions.
- **Uploaded files** are saved under random names, and downloads are checked against the owner.
- **Removing a student from a course** keeps their notes and files. They come back if the student is enrolled again.
- **Deleting a course or user** permanently deletes the related notes, files and messages. The app asks for confirmation first.

> The server listens on `127.0.0.1` only, so it's reachable just from the same computer. Making it available to others needs HTTPS and a production setup (see below).

---

## Configuration

| Setting | Where | Default |
|---|---|---|
| Port | `PORT` environment variable | `8000` |
| Max upload size | `MAX_UPLOAD_BYTES` in `server.py` | 15 MB |
| Database and uploads location | `DB_PATH`, `UPLOAD_DIR` in `server.py` | `data/` |

Example, running on another port:
```bash
PORT=8080 python3 server.py
```

---

## Limitations and next steps

- **Runs on one computer.** To give real students access, it needs hosting with HTTPS, and the listen address in `server.py` changed from `127.0.0.1`.
- **Chats use polling** every 3 seconds, rather than real-time push. That's fine for a class, but WebSockets would scale better.
- **Notes are plain text.** Rich text (bold, lists, images) would need an editor library.
- **No self-registration.** An admin creates every account.
- **No notifications** for new chat messages yet.
- **No automatic backups.** Back up the `data/` folder regularly.
