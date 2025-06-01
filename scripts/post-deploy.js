const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

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
      const phrasesPath = path.join(__dirname, '..', 'data', 'phrases.json');
      console.log('Tentative de lecture du fichier:', phrasesPath);
      
      try {
        const jsonData = await fs.readFile(phrasesPath, 'utf8');
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

// Exécuter l'importation
importPhrases(); 