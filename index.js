// 📁 backend/index.js
const express = require('express');
const { Pool } = require('pg');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const fsp = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configuration de la base de données selon l'environnement
const dbConfig = {
  development: {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'voice_collectes'
  },
  production: {
    host: process.env.DB_HOST || 'dpg-d0u4hv63jp1c73fdi5b0-a',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'ymx3p24csJolVG1VFCCsbzHxPH7d7ApP',
    database: process.env.DB_NAME || 'voice_collectes'
  }
};

// Sélectionner la configuration selon l'environnement
const currentEnv = process.env.NODE_ENV || 'development';
console.log(`Environnement actuel: ${currentEnv}`);

// Créer la connexion à la base de données
let pool;
if (currentEnv === 'development') {
  pool = mysql.createPool(dbConfig.development);
} else {
  pool = new Pool(dbConfig.production);
}

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

// 🔄 Fonction de reconnexion à la base de données
async function waitForDatabase(maxRetries = 5, retryInterval = 5000) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`Tentative de connexion à la base de données (${retries + 1}/${maxRetries})...`);
      console.log(`Configuration DB: ${JSON.stringify(dbConfig[currentEnv], null, 2)}`);
      
      if (currentEnv === 'development') {
        // MySQL
        const connection = await pool.getConnection();
        connection.release();
      } else {
        // PostgreSQL
        const client = await pool.connect();
        client.release();
      }
      
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
    const connection = await pool.getConnection();
    const dbResult = await connection.query('SELECT 1');
    connection.release();

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
  try {
    console.log('Création des tables...');
    
    if (currentEnv === 'development') {
      // MySQL
      const connection = await pool.getConnection();
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS phrases (
            id INT AUTO_INCREMENT PRIMARY KEY,
            text VARCHAR(255) NOT NULL,
            audio_count INT DEFAULT 0
          )
        `);
        
        // Vérifier si la colonne cloudinary_id existe
        const [columns] = await connection.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'audios' 
          AND COLUMN_NAME = 'cloudinary_id'
        `);

        // Créer la table audios si elle n'existe pas
        await connection.query(`
          CREATE TABLE IF NOT EXISTS audios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            phrase_id INT NOT NULL,
            user_id VARCHAR(100),
            audio_url TEXT,
            cloudinary_id VARCHAR(255),
            validated BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (phrase_id) REFERENCES phrases(id)
          )
        `);

        // Ajouter la colonne cloudinary_id si elle n'existe pas
        if (columns.length === 0) {
          console.log('Ajout de la colonne cloudinary_id à la table audios...');
          await connection.query(`
            ALTER TABLE audios 
            ADD COLUMN cloudinary_id VARCHAR(255) AFTER audio_url
          `);
        }
      } finally {
        connection.release();
      }
    } else {
      // PostgreSQL
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS phrases (
            id SERIAL PRIMARY KEY,
            text VARCHAR(255) NOT NULL,
            audio_count INTEGER DEFAULT 0
          )
        `);
        
        // Vérifier si la colonne cloudinary_id existe
        const result = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'audios' 
          AND column_name = 'cloudinary_id'
        `);

        // Créer la table audios si elle n'existe pas
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

        // Ajouter la colonne cloudinary_id si elle n'existe pas
        if (result.rows.length === 0) {
          console.log('Ajout de la colonne cloudinary_id à la table audios...');
          await client.query(`
            ALTER TABLE audios 
            ADD COLUMN cloudinary_id VARCHAR(255)
          `);
        }
      } finally {
        client.release();
      }
    }
    
    console.log('Tables créées avec succès !');
  } catch (error) {
    console.error('Erreur lors de la création des tables:', error);
    throw error;
  }
}

async function importPhrases() {
  try {
    // Attendre que la base de données soit prête
    await waitForDatabase();
    
    if (currentEnv === 'development') {
      // MySQL
      const connection = await pool.getConnection();
      try {
        // Création des tables si elles n'existent pas
        await connection.query(`
          CREATE TABLE IF NOT EXISTS phrases (
            id INT AUTO_INCREMENT PRIMARY KEY,
            text VARCHAR(255) NOT NULL,
            audio_count INT DEFAULT 0
          )
        `);
        
        await connection.query(`
          CREATE TABLE IF NOT EXISTS audios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            phrase_id INT NOT NULL,
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
        console.log('Chemin absolu du fichier:', phrasesPath);
        console.log('__dirname:', __dirname);
        console.log('Vérification de l\'existence du fichier:', fs.existsSync(phrasesPath));
        
        try {
          const jsonData = await fsp.readFile(phrasesPath, 'utf8');
          const phrases = JSON.parse(jsonData);
          console.log(`Nombre de phrases à importer : ${phrases.length}`);

          // Vérifier si des phrases existent déjà
          const [result] = await connection.query('SELECT COUNT(*) as count FROM phrases');
          const existingCount = parseInt(result[0].count);
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
          
          await connection.beginTransaction();
          
          for (const item of phrases) {
            try {
              // Vérifier si la phrase existe déjà
              const [existing] = await connection.query('SELECT id FROM phrases WHERE text = ?', [item.phrase]);
              if (existing.length > 0) {
                skippedCount++;
                continue;
              }

              await connection.query('INSERT INTO phrases (text) VALUES (?)', [item.phrase]);
              insertedCount++;
              
              if (insertedCount % 100 === 0) {
                console.log(`${insertedCount} phrases insérées...`);
              }
            } catch (error) {
              console.error(`Erreur lors de l'insertion de la phrase: ${item.phrase}`, error);
            }
          }
          
          await connection.commit();

          console.log('\nImportation terminée !');
          console.log(`- ${insertedCount} nouvelles phrases insérées`);
          console.log(`- ${skippedCount} phrases ignorées (déjà existantes)`);
          console.log(`- Total des phrases dans la base : ${existingCount + insertedCount}`);

        } catch (error) {
          await connection.rollback();
          console.error('Erreur lors de la lecture du fichier phrases.json:', error);
          throw error;
        }
      } finally {
        connection.release();
      }
    } else {
      // PostgreSQL
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
        console.log('Chemin absolu du fichier:', phrasesPath);
        console.log('__dirname:', __dirname);
        console.log('Vérification de l\'existence du fichier:', fs.existsSync(phrasesPath));
        
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
          await client.query('ROLLBACK');
          console.error('Erreur lors de la lecture du fichier phrases.json:', error);
          throw error;
        }
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.error('Erreur lors de l\'importation:', error);
    process.exit(1);
  }
}


// 📤 Upload audio (auth: user_id = email)
app.post('/audios', upload.single('audio'), async (req, res) => {
  const { phrase_id, user_id } = req.body;
  
  try {
    // Convertir WebM en WAV 16kHz mono
    const inputPath = req.file.path;
    const outputPath = path.join(uploadsDir, `converted-${Date.now()}.wav`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('wav')
        .audioChannels(1)  // Mono
        .audioFrequency(16000)  // 16kHz
        .on('end', () => {
          console.log('Conversion WebM vers WAV 16kHz mono terminée');
          resolve();
        })
        .on('error', (err) => {
          console.error('Erreur lors de la conversion:', err);
          reject(err);
        })
        .save(outputPath);
    });

    // Upload vers Cloudinary
    const result = await cloudinary.uploader.upload(outputPath, {
      resource_type: "auto",
      folder: "voice_collectes/audios",
      format: "wav"
    });

    // Supprimer les fichiers temporaires
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    const audio_url = result.secure_url;
    const cloudinary_id = result.public_id;
    
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'INSERT INTO audios (phrase_id, user_id, audio_url, cloudinary_id) VALUES (?, ?, ?, ?)', 
        [phrase_id, user_id, audio_url, cloudinary_id]
      );
      await connection.query('UPDATE phrases SET audio_count = audio_count + 1 WHERE id = ?', [phrase_id]);
      await connection.commit();
      res.json({ 
        success: true, 
        audio_url,
        cloudinary_id 
      });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res.status(500).json({ error: 'Erreur lors de l\'enregistrement.' });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Erreur lors de l\'upload vers Cloudinary:', error);
    res.status(500).json({ error: 'Erreur lors de l\'upload du fichier audio.' });
  }
});

// 📄 Récupérer une phrase avec audio_count < 10
app.get('/phrases/next', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      'SELECT * FROM phrases WHERE audio_count < 10 ORDER BY RAND() LIMIT 1'
    );
    res.json(rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération.' });
  } finally {
    connection.release();
  }
});

// 📊 Récupérer le nombre de traductions par utilisateur
app.get('/stats/:email', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      'SELECT COUNT(*) as count FROM audios WHERE user_id = ?',
      [req.params.email]
    );
    res.json({ count: parseInt(rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques.' });
  } finally {
    connection.release();
  }
});

// 📦 Exporter toutes les audios avec texte en Excel
app.get('/export/audios', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(`
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
    connection.release();
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
