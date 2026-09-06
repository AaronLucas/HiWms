import { createClient } from '@supabase/supabase-js';
import type { Database } from './src/types/database';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function testSetSession() {
  try {
    const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Create user and tenant
    console.log('📝 Creating user...');
    const testEmail = `test-${Date.now()}@test.invalid`;
    const { data: userData } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: 'TestPassword2026!',
      email_confirm: true,
      user_metadata: { username: 'testuser' },
    });

    const tenantId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    await adminClient.auth.admin.updateUserById(userData.user!.id, {
      app_metadata: { tenant_id: tenantId },
    });

    // Login to get token
    console.log('📝 Logging in...');
    const anonClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data: signInData } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: 'TestPassword2026!',
    });

    const accessToken = signInData.session?.access_token;
    const refreshToken = signInData.session?.refresh_token;

    // Create new client and set session
    console.log('📝 Creating new client and setting session...');
    const authenticatedClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    await authenticatedClient.auth.setSession({
      access_token: accessToken!,
      refresh_token: refreshToken!,
    });

    // Try to query tenants table
    console.log('📝 Querying tenants table...');
    const { data: tenants, error } = await authenticatedClient.from('tenants').select('*').limit(5);

    if (error) {
      console.error('❌ Query failed:', error);
      return;
    }

    console.log('✓ Query succeeded');
    console.log('  Rows returned:', tenants?.length ?? 0);
  } catch (e) {
    console.error('❌ Exception:', e);
  }
}

testSetSession();
