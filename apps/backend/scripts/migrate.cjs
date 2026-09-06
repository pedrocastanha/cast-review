const { DataSource } = require('typeorm');

async function main() {
  if (!process.env.MIGRATION_DATABASE_URL)
    throw new Error('MIGRATION_DATABASE_URL is required');
  const configured =
    require('../dist/shared/database/postgres/postgres.datasource.js').default;
  const { host, port, username, password, database, ...options } =
    configured.options;
  const source = new DataSource({
    ...options,
    url: process.env.MIGRATION_DATABASE_URL,
  });
  await source.initialize();
  const lock = source.createQueryRunner();
  await lock.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(73521941)');
    await source.runMigrations({ transaction: 'all' });
    if (await source.showMigrations()) throw new Error('Pending migrations');
  } finally {
    await lock.query('SELECT pg_advisory_unlock(73521941)');
    await lock.release();
    await source.destroy();
  }
}

main().catch(() => {
  process.stderr.write('Migration failed\n');
  process.exitCode = 1;
});
