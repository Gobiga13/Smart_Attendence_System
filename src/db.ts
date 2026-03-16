import Database from 'better-sqlite3';
import path from 'path';

const db = new Database('attendance.db');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    student_id TEXT UNIQUE NOT NULL,
    face_descriptor TEXT NOT NULL, -- JSON string of the descriptor
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    time TEXT NOT NULL, -- HH:mm:ss
    FOREIGN KEY (student_id) REFERENCES students(student_id),
    UNIQUE(student_id, date) -- Avoid duplicate entries for the same day
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
`);

// Seed admin if not exists
const adminCount = db.prepare('SELECT count(*) as count FROM admins').get() as { count: number };
if (adminCount.count === 0) {
  db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('admin', 'admin123');
}

export default db;
