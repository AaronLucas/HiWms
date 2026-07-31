/**
 * CAPTCHA_PROVIDER 配置解析 + captchaToken 透传回归测试
 *
 * 范围说明：不在本文件里对本地共享的 Supabase Docker 栈做 config.toml 热切换
 * 重启——该栈是本机所有 worktree/session 共用的基础设施，随意重启会打断其他
 * 并行会话正在跑的测试。captchaToken 是 provider-agnostic 字段，GoTrue 端
 * "要不要校验/校验哪个 provider"完全由 Supabase 项目侧 Attack Protection 配置
 * 决定，不是本仓库代码需要重新验证的行为（该行为由 Supabase 官方保证）。这里
 * 只覆盖本仓库代码自己负责的两件事：
 *   1. CAPTCHA_PROVIDER 环境变量的三态解析（none/hcaptcha/turnstile）是否正确
 *   2. captchaToken 透传是否不会破坏现有 signIn 流程（本地默认未启用 CAPTCHA，
 *      验证传入任意 token 时功能依旧正常，不会被当成畸形请求拒绝）
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- captcha.test
 */
import { afterEach, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('CAPTCHA_PROVIDER 三态解析 + captchaToken 透传', () => {
  const originalEnv = process.env.CAPTCHA_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CAPTCHA_PROVIDER;
    else process.env.CAPTCHA_PROVIDER = originalEnv;
    WmsSupabaseClient.reset();
  });

  test.each([
    ['未设置', undefined, 'none'],
    ['无效值', 'recaptcha', 'none'],
    ['hcaptcha', 'hcaptcha', 'hcaptcha'],
    ['HCAPTCHA（大小写不敏感）', 'HCAPTCHA', 'hcaptcha'],
    ['turnstile', 'turnstile', 'turnstile'],
  ])('CAPTCHA_PROVIDER=%s 时应解析为 %s', async (_label, envValue, expectedMode) => {
    if (envValue === undefined) delete process.env.CAPTCHA_PROVIDER;
    else process.env.CAPTCHA_PROVIDER = envValue;

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      WmsSupabaseClient.reset();
      createSupabaseAdapters({
        url: SUPABASE_URL,
        anonKey: SUPABASE_SERVICE_ROLE_KEY,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      });
    } finally {
      console.log = originalLog;
    }

    expect(logs.some(l => l.includes(`CAPTCHA_PROVIDER=${expectedMode}`))).toBe(true);
  });

  test('本地未启用 CAPTCHA 时，signIn 传入任意 captchaToken 都不影响登录结果', async () => {
    delete process.env.CAPTCHA_PROVIDER;
    WmsSupabaseClient.reset();
    const adapters: SupabaseAdapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });

    // 用一个必然不存在的账号验证：传入 captchaToken 不会导致请求本身出错
    // （比如被 GoTrue 当成畸形请求 400），依然是预期的"账号不存在→登录失败(null)"。
    const result = await adapters.auth.provider.signIn(
      'ecc-captcha-passthrough-nonexistent@ecc-test.invalid',
      'irrelevant-password',
      'dummy-captcha-token-for-passthrough-test'
    );
    expect(result).toBeNull();
  });
});
