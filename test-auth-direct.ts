import { createClient } from '@supabase/supabase-js';
import type { Database } from './src/types/database';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function testAuthCreate() {
  try {
    const client = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    console.log('🔍 Testing auth.admin.createUser()...');
    const testEmail = `test-${Date.now()}@test.invalid`;

    const { data, error } = await client.auth.admin.createUser({
      email: testEmail,
      password: 'TestPassword2026!',
      email_confirm: true,
      user_metadata: {
        username: 'testuser',
      },
    });

    if (error) {
      console.error('❌ auth.admin.createUser() failed:', error);
      return;
    }

    console.log('✓ User created successfully');
    console.log('  - User ID:', data.user?.id);
    console.log('  - Email:', data.user?.email);
    console.log('  - app_metadata:', data.user?.app_metadata);
    console.log('  - user_metadata:', data.user?.user_metadata);

    // Now try to update app_metadata
    console.log('\n🔍 Testing auth.admin.updateUserById()...');
    const tenantId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    const { data: updateData, error: updateError } = await client.auth.admin.updateUserById(data.user!.id, {
      app_metadata: { tenant_id: tenantId },
    });

    if (updateError) {
      console.error('❌ updateUserById() failed:', updateError);
      return;
    }

    console.log('✓ User updated successfully');
    console.log('  - app_metadata:', updateData.user?.app_metadata);
  } catch (e) {
    console.error('❌ Exception:', e);
  }
}

testAuthCreate();
