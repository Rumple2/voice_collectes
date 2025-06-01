const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

async function importPhrases() {
    try {
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

        // Préparer la requête d'insertion
        const insertQuery = 'INSERT INTO phrases (text) VALUES (?)';
        
        // Insérer chaque phrase
        let insertedCount = 0;
        for (const item of phrases) {
            try {
                await connection.query(insertQuery, [item.phrase]);
                insertedCount++;
                if (insertedCount % 100 === 0) {
                    console.log(`${insertedCount} phrases insérées...`);
                }
            } catch (error) {
                if (error.code === 'ER_DUP_ENTRY') {
                    console.log(`Phrase déjà existante: ${item.phrase}`);
                } else {
                    console.error(`Erreur lors de l'insertion de la phrase: ${item.phrase}`, error);
                }
            }
        }

        console.log(`\nImportation terminée ! ${insertedCount} phrases ont été insérées.`);
        await connection.end();
    } catch (error) {
        console.error('Erreur lors de l\'importation:', error);
        process.exit(1);
    }
}

// Exécuter l'importation
importPhrases(); 