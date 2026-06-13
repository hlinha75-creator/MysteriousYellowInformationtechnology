require('dotenv').config();
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
const confirmation = process.argv[3];

if (!target || confirmation !== 'CONFIRMAR') {
  console.log('Uso: node scripts/restoreDatabase.js <backup.sqlite> CONFIRMAR');
  console.log('Este script e manual e sobrescreve o banco atual.');
  process.exit(1);
}

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/notag.sqlite');
const backupPath = path.resolve(target);

if (!fs.existsSync(backupPath)) {
  throw new Error(`Backup nao encontrado: ${backupPath}`);
}

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
if (fs.existsSync(databasePath)) {
  const emergency = `${databasePath}.before-restore-${Date.now()}`;
  fs.copyFileSync(databasePath, emergency);
  console.log(`Copia de emergencia criada: ${emergency}`);
}

fs.copyFileSync(backupPath, databasePath);
console.log(`Banco restaurado de ${backupPath}`);
