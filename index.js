// 📁 backend/index.js
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Créer les dossiers nécessaires
const uploadsDir = path.join(__dirname, 'uploads', 'audio');
const exportsDir = path.join(__dirname, 'exports');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(exportsDir, { recursive: true });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 🗄️ Connexion MySQL
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

// 🔍 Vérifier la configuration
app.get('/check-config', async (req, res) => {
  try {
    // Vérifier la connexion à la base de données
    const conn = await mysql.createConnection(dbConfig);
    const [dbResult] = await conn.query('SELECT 1');
    await conn.end();

    // Vérifier les dossiers
    const uploadsExists = fs.existsSync(uploadsDir);
    const exportsExists = fs.existsSync(exportsDir);

    res.json({
      status: 'ok',
      environment: process.env.NODE_ENV,
      database: {
        connected: dbResult.length > 0,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        user: process.env.DB_USER
      },
      directories: {
        uploads: uploadsExists,
        exports: exportsExists
      },
      forceImport: process.env.FORCE_IMPORT === 'true'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      environment: process.env.NODE_ENV,
      database: {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        user: process.env.DB_USER
      }
    });
  }
});

// 📥 Configurer Multer pour upload audio
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// 🔧 Création des tables au démarrage
async function createTables() {
  const conn = await mysql.createConnection(dbConfig);
  await conn.query(`CREATE TABLE IF NOT EXISTS phrases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    text VARCHAR(255) NOT NULL,
    audio_count INT DEFAULT 0
  )`);
  await conn.query(`CREATE TABLE IF NOT EXISTS audios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phrase_id INT NOT NULL,
    user_id VARCHAR(100),
    audio_url TEXT,
    validated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phrase_id) REFERENCES phrases(id)
  )`);
  await conn.end();
}

// 📤 Upload audio (auth: user_id = email)
app.post('/audios', upload.single('audio'), async (req, res) => {
  const { phrase_id, user_id } = req.body;
  const audio_url = `/uploads/audio/${req.file.filename}`;

  try {
    const conn = await mysql.createConnection(dbConfig);
    await conn.query('INSERT INTO audios (phrase_id, user_id, audio_url) VALUES (?, ?, ?)', [phrase_id, user_id, audio_url]);
    await conn.query('UPDATE phrases SET audio_count = audio_count + 1 WHERE id = ?', [phrase_id]);
    await conn.end();
    res.json({ success: true, audio_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement.' });
  }
});

// 📄 Récupérer une phrase avec audio_count < 10
app.get('/phrases/next', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.query('SELECT * FROM phrases WHERE audio_count < 10 ORDER BY RAND() LIMIT 1');
    await conn.end();
    res.json(rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération.' });
  }
});

// 📊 Récupérer le nombre de traductions par utilisateur
app.get('/stats/:email', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.query('SELECT COUNT(*) as count FROM audios WHERE user_id = ?', [req.params.email]);
    await conn.end();
    res.json({ count: rows[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques.' });
  }
});

// 📦 Exporter toutes les audios avec texte en Excel
app.get('/export/audios', async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.query(`
      SELECT a.id, p.text AS phrase, a.user_id, a.audio_url, a.created_at
      FROM audios a
      JOIN phrases p ON a.phrase_id = p.id
    `);
    await conn.end();

    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Audios');

    const exportPath = path.join(exportsDir, 'audios_export.xlsx');
    xlsx.writeFile(workbook, exportPath);

    res.download(exportPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'exportation.' });
  }
});

// 🚀 Démarrer serveur et créer tables
app.listen(port, async () => {
  await createTables();
  console.log(`Serveur démarré sur http://localhost:${port}`);
});
