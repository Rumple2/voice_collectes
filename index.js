// 📁 backend/index.js
const express = require('express');
const { Pool } = require('pg');
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

// 🗄️ Connexion PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'dpg-d0u4hv63jp1c73fdi5b0-a',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'ymx3p24csJolVG1VFCCsbzHxPH7d7ApP',
  database: process.env.DB_NAME || 'voice_collectes'
});

// 🔄 Fonction de reconnexion à la base de données
async function waitForDatabase(maxRetries = 5, retryInterval = 5000) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`Tentative de connexion à la base de données (${retries + 1}/${maxRetries})...`);
      const client = await pool.connect();
      client.release();
      console.log('Connexion à la base de données réussie !');
      return true;
    } catch (error) {
      retries++;
      console.error(`Erreur de connexion (${retries}/${maxRetries}):`, error.message);
      
      if (retries < maxRetries) {
        console.log(`Nouvelle tentative dans ${retryInterval/1000} secondes...`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }
  }
  
  throw new Error('Impossible de se connecter à la base de données après plusieurs tentatives');
}

// 🔍 Vérifier la configuration
app.get('/check-config', async (req, res) => {
  try {
    // Vérifier la connexion à la base de données
    const client = await pool.connect();
    const dbResult = await client.query('SELECT 1');
    client.release();

    // Vérifier les dossiers
    const uploadsExists = fs.existsSync(uploadsDir);
    const exportsExists = fs.existsSync(exportsDir);

    res.json({
      status: 'ok',
      environment: process.env.NODE_ENV,
      database: {
        connected: dbResult.rows.length > 0,
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
  const client = await pool.connect();
  try {
    console.log('Création des tables...');
    
    await client.query(`CREATE TABLE IF NOT EXISTS phrases (
      id SERIAL PRIMARY KEY,
      text VARCHAR(255) NOT NULL,
      audio_count INTEGER DEFAULT 0
    )`);
    
    await client.query(`CREATE TABLE IF NOT EXISTS audios (
      id SERIAL PRIMARY KEY,
      phrase_id INTEGER NOT NULL,
      user_id VARCHAR(100),
      audio_url TEXT,
      validated BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phrase_id) REFERENCES phrases(id)
    )`);
    
    console.log('Tables créées avec succès !');
  } catch (error) {
    console.error('Erreur lors de la création des tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// 📤 Upload audio (auth: user_id = email)
app.post('/audios', upload.single('audio'), async (req, res) => {
  const { phrase_id, user_id } = req.body;
  const audio_url = `/uploads/audio/${req.file.filename}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO audios (phrase_id, user_id, audio_url) VALUES ($1, $2, $3)', 
      [phrase_id, user_id, audio_url]);
    await client.query('UPDATE phrases SET audio_count = audio_count + 1 WHERE id = $1', [phrase_id]);
    await client.query('COMMIT');
    res.json({ success: true, audio_url });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement.' });
  } finally {
    client.release();
  }
});

// 📄 Récupérer une phrase avec audio_count < 10
app.get('/phrases/next', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM phrases WHERE audio_count < 10 ORDER BY RANDOM() LIMIT 1'
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération.' });
  } finally {
    client.release();
  }
});

// 📊 Récupérer le nombre de traductions par utilisateur
app.get('/stats/:email', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT COUNT(*) as count FROM audios WHERE user_id = $1',
      [req.params.email]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques.' });
  } finally {
    client.release();
  }
});

// 📦 Exporter toutes les audios avec texte en Excel
app.get('/export/audios', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT a.id, p.text AS phrase, a.user_id, a.audio_url, a.created_at
      FROM audios a
      JOIN phrases p ON a.phrase_id = p.id
    `);

    const worksheet = xlsx.utils.json_to_sheet(result.rows);
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

// 🚀 Démarrer serveur et créer tables
app.listen(port, async () => {
  try {
    console.log(`Serveur démarré sur http://localhost:${port}`);
    console.log('Attente de la base de données...');
    await waitForDatabase();
    await createTables();
    console.log('Application prête !');
  } catch (error) {
    console.error('Erreur au démarrage:', error);
    process.exit(1);
  }
});
