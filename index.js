// 📁 backend/index.js
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const fsp = require('fs').promises;

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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

// 📥 Configurer Multer pour upload audio temporaire
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
      cloudinary_id VARCHAR(255),
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

async function waitForDatabase(maxRetries = 10, retryInterval = 10000) {
  const pool = new Pool({
    host: process.env.DB_HOST || 'dpg-d0u4hv63jp1c73fdi5b0-a',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'ymx3p24csJolVG1VFCCsbzHxPH7d7ApP',
    database: process.env.DB_NAME || 'voice_collectes'
  });

  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`Tentative de connexion à la base de données (${retries + 1}/${maxRetries})...`);
      const client = await pool.connect();
      client.release();
      console.log('Connexion à la base de données réussie !');
      return pool;
    } catch (error) {
      retries++;
      console.error(`Erreur de connexion (${retries}/${maxRetries}):`, error.message);
      
      if (retries < maxRetries) {
        console.log(`Nouvelle tentative dans ${retryInterval/1000} secondes...`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }
  }
  
  console.error('Impossible de se connecter à la base de données après plusieurs tentatives');
  process.exit(1);
}

async function importPhrases() {
  let pool;
  try {
    // Attendre que la base de données soit prête
    pool = await waitForDatabase();
    const client = await pool.connect();
    
    try {
      // Création des tables si elles n'existent pas
      await client.query(`
        CREATE TABLE IF NOT EXISTS phrases (
          id SERIAL PRIMARY KEY,
          text VARCHAR(255) NOT NULL,
          audio_count INTEGER DEFAULT 0
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS audios (
          id SERIAL PRIMARY KEY,
          phrase_id INTEGER NOT NULL,
          user_id VARCHAR(100),
          audio_url TEXT,
          cloudinary_id VARCHAR(255),
          validated BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (phrase_id) REFERENCES phrases(id)
        )
      `);

      // Lire le fichier JSON
      const phrasesPath = path.join(__dirname, 'data', 'phrases.json');
      console.log('Tentative de lecture du fichier:', phrasesPath);
      
      try {
        const jsonData = await fsp.readFile(phrasesPath, 'utf8');
        const phrases = JSON.parse(jsonData);
        console.log(`Nombre de phrases à importer : ${phrases.length}`);

        // Vérifier si des phrases existent déjà
        const result = await client.query('SELECT COUNT(*) as count FROM phrases');
        const existingCount = parseInt(result.rows[0].count);
        console.log(`Nombre de phrases existantes : ${existingCount}`);

        if (existingCount > 0) {
          const shouldContinue = process.env.FORCE_IMPORT === 'true';
          if (!shouldContinue) {
            console.log('Des phrases existent déjà. Pour forcer l\'importation, définissez FORCE_IMPORT=true');
            return;
          }
          console.log('FORCE_IMPORT=true détecté, importation forcée...');
        }

        // Insérer chaque phrase
        let insertedCount = 0;
        let skippedCount = 0;
        
        await client.query('BEGIN');
        
        for (const item of phrases) {
          try {
            // Vérifier si la phrase existe déjà
            const existing = await client.query('SELECT id FROM phrases WHERE text = $1', [item.phrase]);
            if (existing.rows.length > 0) {
              skippedCount++;
              continue;
            }

            await client.query('INSERT INTO phrases (text) VALUES ($1)', [item.phrase]);
            insertedCount++;
            
            if (insertedCount % 100 === 0) {
              console.log(`${insertedCount} phrases insérées...`);
            }
          } catch (error) {
            console.error(`Erreur lors de l'insertion de la phrase: ${item.phrase}`, error);
          }
        }
        
        await client.query('COMMIT');

        console.log('\nImportation terminée !');
        console.log(`- ${insertedCount} nouvelles phrases insérées`);
        console.log(`- ${skippedCount} phrases ignorées (déjà existantes)`);
        console.log(`- Total des phrases dans la base : ${existingCount + insertedCount}`);

      } catch (error) {
        console.error('Erreur lors de la lecture du fichier phrases.json:', error);
        throw error;
      }

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erreur lors de l\'importation:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}


// 📤 Upload audio (auth: user_id = email)
app.post('/audios', upload.single('audio'), async (req, res) => {
  const { phrase_id, user_id } = req.body;
  
  try {
    // Upload vers Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: "auto",
      folder: "voice_collectes/audios"
    });

    // Supprimer le fichier temporaire
    fs.unlinkSync(req.file.path);

    const audio_url = result.secure_url;
    const cloudinary_id = result.public_id;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO audios (phrase_id, user_id, audio_url, cloudinary_id) VALUES ($1, $2, $3, $4)', 
        [phrase_id, user_id, audio_url, cloudinary_id]
      );
      await client.query('UPDATE phrases SET audio_count = audio_count + 1 WHERE id = $1', [phrase_id]);
      await client.query('COMMIT');
      res.json({ 
        success: true, 
        audio_url,
        cloudinary_id 
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Erreur lors de l\'enregistrement.' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erreur lors de l\'upload vers Cloudinary:', error);
    res.status(500).json({ error: 'Erreur lors de l\'upload du fichier audio.' });
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
    await importPhrases();
    console.log('Application prête !');
  } catch (error) {
    console.error('Erreur au démarrage:', error);
    process.exit(1);
  }
});
