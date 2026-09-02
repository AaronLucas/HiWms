import { createClient } from '@supabase/supabase-js';
import type { Database } from './src/types/database';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function testJWTContent() {
  try {
    // Create user with service role
    const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    console.log('📝 Step 1: Creating user...');
    const testEmail = `test-${Date.now()}@test.invalid`;
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: 'TestPassword2026!',
      email_confirm: true,
      user_metadata: { username: 'testuser' },
    });

    if (createError) {
      console.error('❌ Create failed:', createError);
      return;
    }

    console.log('✓ User created:', createData.user?.id);

    // Update app_metadata
    console.log('\n📝 Step 2: Updating app_metadata...');
    const tenantId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const { data: updateData, error: updateError } = await adminClient.auth.admin.updateUserById(
      createData.user!.id,
      { app_metadata: { tenant_id: tenantId } }
    );

    if (updateError) {
      console.error('❌ Update failed:', updateError);
      return;
    }

    console.log('✓ app_metadata updated');

    // Login with anon client
    console.log('\n📝 Step 3: Logging in...');
    const anonClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: 'TestPassword2026!',
    });

    if (signInError) {
      console.error('❌ Sign in failed:', signInError);
      return;
    }

    console.log('✓ Sign in successful');

    // Decode JWT
    const token = signInData.session?.access_token;
    if (!token) {
      console.error('❌ No access token');
      return;
    }

    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    console.log('\n📋 JWT Payload:');
    console.log('  - sub:', payload.sub);
    console.log('  - email:', payload.email);
    console.log('  - app_metadata:', JSON.stringify(payload.app_metadata, null, 2));
    console.log('  - aud:', payload.aud);
  } catch (e) {
    console.error('❌ Exception:', e);
  }
}

testJWTContent();
