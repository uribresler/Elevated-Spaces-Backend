#!/usr/bin/env node

const pg = require('pg');
const fs = require('fs');
const path = require('path');

// Parse .env file
function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const envVars = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('#') || !line.trim()) continue;
      const match = line.match(/^\s*([^=]+?)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\n#]+))\s*(?:#.*)?$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2] || match[3] || (match[4] && match[4].trim());
        if (value) envVars[key] = value;
      }
    }
    return envVars;
  } catch (err) {
    console.error('Failed to parse .env:', err.message);
    return {};
  }
}

async function testConnection(connString, label) {
  console.log('\n' + '='.repeat(60));
  console.log('Testing: ' + label);
  console.log('='.repeat(60));
  
  const masked = connString.replace(/:[^:@]+@/, ':<redacted>@');
  console.log('Connection String: ' + masked);
  
  const pool = new pg.Pool({ connectionString: connString });
  
  try {
    const result = await pool.query('SELECT NOW() as now, version() as version');
    console.log('✅ SUCCESS');
    console.log('   Server time: ' + result.rows[0].now);
    console.log('   PostgreSQL: ' + result.rows[0].version.split(',')[0]);
    return true;
  } catch (err) {
    console.log('❌ FAILED: ' + err.message);
    if (err.code) console.log('   Error code: ' + err.code);
    return false;
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('🔍 Database Connection Diagnostic Tool\n');
  
  // Load .env
  const envPath = path.join(__dirname, '.env');
  console.log('Loading .env from: ' + envPath);
  const env = loadEnv(envPath);
  
  const dbUrl = env.DATABASE_URL || env.DIRECT_URL || env.POSTGRES_URL;
  
  if (!dbUrl) {
    console.error('❌ No DATABASE_URL, DIRECT_URL, or POSTGRES_URL found in .env');
    process.exit(1);
  }
  
  console.log('Found connection string: ' + dbUrl.replace(/:[^:@]+@/, ':<redacted>@') + '\n');
  
  // Test 1: Current connection string
  const test1 = await testConnection(dbUrl, 'Current .env connection string');
  
  // Test 2: Try with URL-encoded password (& → %26)
  if (dbUrl.includes('&')) {
    const encodedUrl = dbUrl.replace(/&/g, '%26');
    await testConnection(encodedUrl, 'With & URL-encoded to %26');
  }
  
  // Test 3: Try with unencoded password (decode %26 and %23)
  const decodedUrl = dbUrl.replace(/%26/g, '&').replace(/%23/g, '#');
  if (decodedUrl !== dbUrl) {
    await testConnection(decodedUrl, 'With password fully decoded');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 Next steps:');
  console.log('='.repeat(60));
  
  if (!test1) {
    console.log('');
    console.log('1. Go to your Supabase dashboard: https://app.supabase.com');
    console.log('2. Select project: kkaadonjqhhgupwnrhzc');
    console.log('3. Click Settings → Database → Connection Pooling');
    console.log('4. Copy the connection string (Pooling mode, not Direct)');
    console.log('5. Replace DATABASE_URL or DIRECT_URL in .env with the correct string');
    console.log('6. Restart: npm run dev (or send "rs" to nodemon)');
    console.log('7. Rerun: npm run test:db-connection');
  } else {
    console.log('');
    console.log('✅ Connection is working!');
    console.log('   - Run: npm run dev');
    console.log('   - API: http://localhost:3003');
  }
}

main().catch(console.error);
