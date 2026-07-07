import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  console.error('Please set them in .env file or export them');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runMigration() {
  const migrationPath = join(__dirname, 'supabase/migrations/001_enterprise_core_schema.sql');
  const sql = readFileSync(migrationPath, 'utf-8');

  console.log('📄 Reading migration file:', migrationPath);
  console.log('📊 SQL size:', sql.length, 'chars');

  // Split by semicolon but be careful with function definitions
  // For simplicity, we'll execute the whole file as one statement
  // Note: This requires the Supabase SQL editor or psql for complex scripts
  // Using rpc to execute raw SQL

  console.log('🚀 Executing migration...');

  try {
    // Execute via raw SQL RPC (requires pgexec extension or similar)
    // Alternative: Split into individual statements
    const statements = splitSQLStatements(sql);

    console.log(`📝 Found ${statements.length} statements to execute`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (!stmt || stmt.startsWith('--') || stmt.startsWith('/*')) continue;

      try {
        // Use the Supabase REST API to execute raw SQL
        // This requires the `pg_stat_statements` or direct SQL execution capability
        const { data, error } = await supabase.rpc('exec_sql', { sql: stmt });

        if (error) {
          // Some statements might fail due to "already exists" - that's OK
          if (error.message.includes('already exists') ||
              error.message.includes('duplicate') ||
              error.message.includes('exists')) {
            console.log(`  ⚠️  Statement ${i + 1}: Skipped (already exists)`);
            success++;
          } else {
            console.error(`  ❌ Statement ${i + 1} failed:`, error.message);
            console.error('     SQL:', stmt.substring(0, 200) + '...');
            failed++;
          }
        } else {
          console.log(`  ✅ Statement ${i + 1} executed`);
          success++;
        }
      } catch (e) {
        console.error(`  ❌ Statement ${i + 1} exception:`, e.message);
        failed++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  ✅ Success: ${success}`);
    console.log(`  ❌ Failed: ${failed}`);
    console.log(`  📝 Total: ${statements.length}`);

    if (failed > 0) {
      console.log('\n⚠️  Some statements failed. This may be expected for "already exists" cases.');
      console.log('   Check Supabase Dashboard > SQL Editor for manual execution of failed statements.');
    } else {
      console.log('\n🎉 All statements executed successfully!');
    }

  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  }
}

function splitSQLStatements(sql: string): string[] {
  // Simple split by semicolon, but handle dollar-quoted strings ($$...$$)
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1] || '';

    // Detect dollar quote start/end
    if (char === '$' && nextChar === '$') {
      if (!inDollarQuote) {
        inDollarQuote = true;
        dollarTag = '$$';
      } else if (dollarTag === '$$') {
        inDollarQuote = false;
        dollarTag = '';
      }
      current += '$$';
      i++; // skip next $
      continue;
    }

    // Detect tagged dollar quotes like $tag$
    if (char === '$' && /^[a-zA-Z_][a-zA-Z0-9_]*\$/.test(sql.slice(i))) {
      const match = sql.slice(i).match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)\$/);
      if (match) {
        const tag = match[0];
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = tag;
        } else if (dollarTag === tag) {
          inDollarQuote = false;
          dollarTag = '';
        }
        current += tag;
        i += tag.length - 1;
        continue;
      }
    }

    current += char;

    // Split on semicolon when not in dollar quote
    if (char === ';' && !inDollarQuote) {
      statements.push(current);
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current);
  }

  return statements;
}

runMigration();