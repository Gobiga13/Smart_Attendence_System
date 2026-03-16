import express from "express";
import { createServer as createViteServer } from "vite";
import db from "./src/db.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, password);
    if (admin) {
      res.json({ success: true, user: { username } });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  });

  app.get("/api/students", (req, res) => {
    const students = db.prepare('SELECT id, name, student_id, face_descriptor FROM students').all();
    res.json(students);
  });

  app.post("/api/students", (req, res) => {
    const { name, student_id, face_descriptor } = req.body;
    try {
      db.prepare('INSERT INTO students (name, student_id, face_descriptor) VALUES (?, ?, ?)').run(name, student_id, JSON.stringify(face_descriptor));
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

  app.post("/api/attendance", (req, res) => {
    const { student_id } = req.body;
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];

    try {
      // Use INSERT OR REPLACE to update the time for the same day, 
      // which moves the record to the top of the "Recent" lists.
      db.prepare(`
        INSERT INTO attendance (student_id, date, time) 
        VALUES (?, ?, ?)
        ON CONFLICT(student_id, date) DO UPDATE SET time = excluded.time
      `).run(student_id, date, time);
      
      res.json({ success: true, message: "Attendance updated" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/attendance", (req, res) => {
    const { date } = req.query;
    let query = `
      SELECT a.*, s.name 
      FROM attendance a 
      JOIN students s ON a.student_id = s.student_id
    `;
    const params: any[] = [];

    if (date) {
      query += " WHERE a.date = ?";
      params.push(date);
    }

    query += " ORDER BY a.date DESC, a.time DESC";
    
    const records = db.prepare(query).all(...params);
    res.json(records);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
