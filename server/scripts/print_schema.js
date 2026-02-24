const { initDb } = require('../db');

function main() {
  const db = initDb();
  const userVersion = db.pragma('user_version', { simple: true });
  const albumColumns = db.prepare('PRAGMA table_info(albums)').all();

  console.log(`user_version=${userVersion}`);
  console.log('albums columns:');
  for (const column of albumColumns) {
    console.log(`- ${column.name} (${column.type || 'TEXT'})`);
  }

  db.close();
}

main();
