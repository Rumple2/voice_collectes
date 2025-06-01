const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

async function waitForDatabase(maxRetries = 10, retryInterval = 10000) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`Tentative de connexion à la base de données (${retries + 1}/${maxRetries})...`);
      const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
      });
      await conn.end();
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
  
  console.error('Impossible de se connecter à la base de données après plusieurs tentatives');
  console.log('L\'importation sera effectuée au prochain déploiement');
  process.exit(0); // Exit with success to allow the build to continue
}

async function importPhrases() {
  try {
    // Attendre que la base de données soit prête
    await waitForDatabase();

    // Lire le fichier JSON
    const jsonData = await fs.readFile(path.join(__dirname, '../data/phrases.json'), 'utf8');
    const phrases = JSON.parse(jsonData);

    // Configuration de la base de données
    const dbConfig = {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };

    // Connexion à la base de données
    const connection = await mysql.createConnection(dbConfig);
    console.log('Connecté à la base de données');

    // Vérifier si des phrases existent déjà
    const [existingPhrases] = await connection.query('SELECT COUNT(*) as count FROM phrases');
    if (existingPhrases[0].count > 0) {
      console.log(`${existingPhrases[0].count} phrases existent déjà dans la base de données.`);
      const shouldContinue = process.env.FORCE_IMPORT === 'true';
      if (!shouldContinue) {
        console.log('Pour forcer l\'importation, définissez FORCE_IMPORT=true dans les variables d\'environnement.');
        await connection.end();
        return;
      }
    }

    // Préparer la requête d'insertion
    const insertQuery = 'INSERT INTO phrases (text) VALUES (?)';
    
    // Insérer chaque phrase
    let insertedCount = 0;
    let skippedCount = 0;
    for (const item of phrases) {
      try {
        // Vérifier si la phrase existe déjà
        const [existing] = await connection.query('SELECT id FROM phrases WHERE text = ?', [item.phrase]);
        if (existing.length > 0) {
          skippedCount++;
          continue;
        }

        await connection.query(insertQuery, [item.phrase]);
        insertedCount++;
        if (insertedCount % 100 === 0) {
          console.log(`${insertedCount} phrases insérées...`);
        }
      } catch (error) {
        console.error(`Erreur lors de l'insertion de la phrase: ${item.phrase}`, error);
      }
    }

    console.log(`\nImportation terminée !`);
    console.log(`- ${insertedCount} nouvelles phrases insérées`);
    console.log(`- ${skippedCount} phrases ignorées (déjà existantes)`);
    await connection.end();
  } catch (error) {
    console.error('Erreur lors de l\'importation:', error);
    // Ne pas échouer le build en cas d'erreur
    process.exit(0);
  }
}

// Exécuter l'importation
importPhrases(); 