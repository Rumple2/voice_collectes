const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// 🌩️ Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'voice_collectes',
    resource_type: 'auto',
    format: 'mp3'
  }
});

const audioFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith('audio/')) {
    return cb(new Error('Seuls les fichiers audio sont acceptés'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter: audioFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 📁 Dossiers
const uploadsDir = path.join(__dirname, 'uploads', 'audio');
const exportsDir = path.join(__dirname, 'exports');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(exportsDir, { recursive: true });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 🗄️ Connexion PostgreSQL
const pool = new Pool({
  user: 'root',
  host: 'dpg-d0u4hv63jp1c73fdi5b0-a',
  database: 'voice_collectes',
  password: 'ymx3p24csJolVG1VFCCsbzHxPH7d7ApP',
  port: 5432
});

// 🔧 Création des tables
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS phrases (
        id SERIAL PRIMARY KEY,
        text VARCHAR(255) NOT NULL,
        audio_count INT DEFAULT 0
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS audios (
        id SERIAL PRIMARY KEY,
        phrase_id INT NOT NULL REFERENCES phrases(id),
        user_id VARCHAR(100),
        audio_url TEXT,
        validated BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    client.release();
  }
}

// 📤 Upload audio
app.post('/audios', upload.single('audio'), async (req, res) => {
  const { phrase_id, user_id } = req.body;

  if (!req.file) {
    return res.status(400).json({
      error: 'Erreur lors de l\'upload',
      details: 'Format audio invalide. Le fichier doit être en WAV, 16kHz, mono.'
    });
  }

  const audio_url = req.file.path;

  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO audios (phrase_id, user_id, audio_url) VALUES ($1, $2, $3)',
      [phrase_id, user_id, audio_url]
    );
    await client.query(
      'UPDATE phrases SET audio_count = audio_count + 1 WHERE id = $1',
      [phrase_id]
    );
    res.json({ success: true, audio_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement.' });
  } finally {
    client.release();
  }
});

// 📄 Phrase avec audio_count < 500
app.get('/phrases/next', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT * FROM phrases WHERE audio_count < 1000 ORDER BY RANDOM() LIMIT 1'
    );
    res.json(rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération.' });
  } finally {
    client.release();
  }
});

// 📊 Statistiques utilisateur
app.get('/stats/:email', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT COUNT(*) AS count FROM audios WHERE user_id = $1',
      [req.params.email]
    );
    res.json({ count: parseInt(rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques.' });
  } finally {
    client.release();
  }
});

// 📦 Exporter audios en Excel
app.get('/export/audios', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT a.id, p.text AS phrase, a.user_id, a.audio_url, a.created_at
      FROM audios a
      JOIN phrases p ON a.phrase_id = p.id
    `);

    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Audios');

    const exportPath = path.join(exportsDir, 'audios_export.xlsx');
    xlsx.writeFile(workbook, exportPath);

    res.download(exportPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'exportation.' });
  } finally {
    client.release();
  }
});

// 🚀 Lancer le serveur
app.listen(port, async () => {
  await createTables();
  console.log(`Serveur démarré sur http://localhost:${port}`);
});
