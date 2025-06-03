const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

async function importPhrases() {
  try {
    // Lire le fichier JSON
    const jsonData = await fs.readFile(path.join(__dirname, '../data/phrases.json'), 'utf8');
    const phrases = JSON.parse(jsonData);

    // Configuration PostgreSQL
    const pool = new Pool({
      user: 'postgres',
      host: 'localhost',
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: 5432
    });

    const client = await pool.connect();
    console.log('Connecté à la base de données');

    const insertQuery = 'INSERT INTO phrases (text) VALUES ($1) ON CONFLICT DO NOTHING';

    let insertedCount = 0;
    for (const item of phrases) {
      try {
        await client.query(insertQuery, [item.phrase]);
        insertedCount++;
        if (insertedCount % 100 === 0) {
          console.log(`${insertedCount} phrases insérées...`);
        }
      } catch (error) {
        console.error(`Erreur lors de l'insertion de la phrase: ${item.phrase}`, error);
      }
    }

    console.log(`\nImportation terminée ! ${insertedCount} phrases ont été insérées.`);
    client.release();
    await pool.end();
  } catch (error) {
    console.error('Erreur lors de l\'importation:', error);
    process.exit(1);
  }
}

// Exécuter l'importation
importPhrases();
