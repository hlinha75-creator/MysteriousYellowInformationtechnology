const fs = require('fs');
const path = require('path');
const { migrate } = require('../src/database/migrate');
const snapshots = require('../src/modules/members/memberSnapshot.service');

function usage() {
  return [
    'Uso: node scripts/importMemberSnapshot.js <arquivo> [origem]',
    '',
    'Exemplo:',
    '  node scripts/importMemberSnapshot.js membros-semana.tsv "lista semanal"'
  ].join('\n');
}

function main(argv = process.argv) {
  const filePath = argv[2];
  const sourceName = argv[3] || (filePath ? path.basename(filePath) : null);

  if (!filePath) {
    console.error(usage());
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Arquivo nao encontrado: ${resolvedPath}`);
    process.exit(1);
  }

  migrate();

  const text = fs.readFileSync(resolvedPath, 'utf8');
  const result = snapshots.importMemberSnapshot(text, {
    sourceName,
    actorId: 'script'
  });

  console.log(`Snapshot #${result.id} importado.`);
  console.log(`Membros: ${result.memberCount}`);
  console.log(`Online: ${result.onlineCount}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
