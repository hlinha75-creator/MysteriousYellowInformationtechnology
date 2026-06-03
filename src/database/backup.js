const fs = require('fs');
const path = require('path');
const env = require('../config/env');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupDatabase(reason = 'manual') {
  const databasePath = path.resolve(env.databasePath);
  if (!fs.existsSync(databasePath)) {
    return null;
  }

  const backupDir = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const safeReason = reason.replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
  const backupPath = path.join(backupDir, `notag-${timestamp()}-${safeReason}.sqlite`);
  fs.copyFileSync(databasePath, backupPath);
  return backupPath;
}

module.exports = {
  backupDatabase
};
