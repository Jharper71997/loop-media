// Runs a single .sql file against Postgres. Connection from PG* env vars / DATABASE_URL.
//   node scripts/run-sql.js supabase/migrations/0004_first_city_jacksonville.sql
const fs = require('fs')
const { Client } = require('pg')

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node scripts/run-sql.js <file.sql>')
    process.exit(1)
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL || undefined,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  await client.query(fs.readFileSync(file, 'utf8'))
  await client.end()
  console.log('Applied', file)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
