// Applies supabase/migrations/*.sql in order against a Postgres connection.
// Connection comes from standard PG* env vars (PGHOST, PGPORT, PGUSER,
// PGPASSWORD, PGDATABASE) or DATABASE_URL — never hard-coded here.
//
//   PGHOST=... PGUSER=... PGPASSWORD=... node scripts/apply-migrations.js
//
// Each file runs in its own implicit transaction, so a failure rolls that file
// back cleanly. Re-running is safe: 0003 is guarded, and 0001/0002 will error
// loudly if objects already exist (drop/reset the schema first to re-apply).

const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const FILES = ['0001_init.sql', '0002_rls.sql', '0003_seed.sql']
const DIR = path.join(__dirname, '..', 'supabase', 'migrations')

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || undefined,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log('Connected.\n')

  for (const file of FILES) {
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8')
    process.stdout.write(`Applying ${file} ... `)
    await client.query(sql)
    console.log('ok')
  }

  const { rows } = await client.query(
    `select count(*)::int as tables
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`
  )
  console.log(`\nDone. public schema now has ${rows[0].tables} tables.`)
  await client.end()
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
