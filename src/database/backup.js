const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
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

function latestBackupFile() {
  const databasePath = path.resolve(env.databasePath);
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  if (!fs.existsSync(backupDir)) return null;
  const files = fs.readdirSync(backupDir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return { name, path: fullPath, size: stat.size, modifiedAt: stat.mtime };
    })
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return files[0] || null;
}

function testLatestBackupRestore() {
  const latest = latestBackupFile();
  if (!latest) {
    return {
      ok: false,
      message: 'Nenhum backup .sqlite encontrado.',
      latest: null,
      checks: []
    };
  }

  const tempPath = path.join(os.tmpdir(), `notag-backup-test-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  const checks = [];
  let db = null;

  try {
    fs.copyFileSync(latest.path, tempPath);
    db = new Database(tempPath, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    checks.push({ name: 'integrity_check', ok: integrity === 'ok', value: String(integrity) });
    for (const table of ['users', 'balances', 'balance_transactions', 'events', 'event_participants']) {
      checks.push(tableCountCheck(db, table));
    }
  } catch (error) {
    checks.push({ name: 'erro', ok: false, value: error.message });
  } finally {
    if (db) db.close();
    fs.rmSync(tempPath, { force: true });
  }

  return {
    ok: checks.every((check) => check.ok),
    message: checks.every((check) => check.ok)
      ? 'Backup abriu e passou nos testes basicos.'
      : 'Backup abriu com erro ou falhou em algum teste.',
    latest,
    checks
  };
}

function tableCountCheck(db, tableName) {
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
    if (!exists) return { name: tableName, ok: false, value: 'tabela ausente' };
    const count = db.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get()?.total || 0;
    return { name: tableName, ok: true, value: `${count} linha(s)` };
  } catch (error) {
    return { name: tableName, ok: false, value: error.message };
  }
}

module.exports = {
  backupDatabase,
  latestBackupFile,
  testLatestBackupRestore
};
