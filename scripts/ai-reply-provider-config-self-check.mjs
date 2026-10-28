import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// An isolated copy avoids loading the developer's .env files or credentials.
const root = mkdtempSync(join(tmpdir(), 'alove-provider-config-'));
try {
  mkdirSync(join(root, 'server'));
  const configPath = join(root, 'server/config.mjs');
  copyFileSync(new URL('../server/config.js', import.meta.url), configPath);
  const load = (overrides = {}) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { SERVER_CONFIG } from ${JSON.stringify(pathToFileURL(configPath).href)};
      const { openai, venice, fallbackOpenai, chatTimeouts, replyChain } = SERVER_CONFIG.aiReply;
      console.log(JSON.stringify({openai, venice, fallbackOpenai, chatTimeouts, replyChain}));
    `], { encoding: 'utf8', env: {
      OPENAI_BASE_URL: 'https://primary.example.test/v1/', OPENAI_API_KEY: 'fixture-primary',
      OPENAI_MODEL: 'fixture-primary', OPENAI_API_MODE: 'responses', OPENAI_TIMEOUT_MS: '24000',
      OPENAI_FALLBACK_MODEL: 'fixture-backup', ...overrides,
    } });
    assert.equal(child.status, 0, 'isolated config child must exit successfully');
    return JSON.parse(child.stdout);
  };
  const baseline = load();
  for (const apiKey of ['', 'fixture-official-deepseek']) {
    const official = load({ AI_REPLY_PROVIDER: 'openai', VENICE_API_KEY: 'fixture-venice',
      OPENAI_BASE_URL: 'https://api.deepseek.com', OPENAI_MODEL: 'deepseek-flash',
      OPENAI_API_KEY: apiKey, OPENAI_API_MODE: 'responses', OPENAI_REASONING_EFFORT: 'low',
      OPENAI_REVIEW_PROFILE: '', OPENAI_FALLBACK_MODEL: '', OPENAI_FALLBACK_API_KEY: '',
      OPENAI_FALLBACK_STREAM: 'false' });
    const active = official.replyChain.filter(provider => provider.apiKey && provider.model);
    assert.deepEqual(active.map(provider => provider.id), apiKey ? ['venice', 'openai'] : ['venice']);
    assert.equal(official.openai.baseUrl, 'https://api.deepseek.com');
    assert.equal(official.openai.model, 'deepseek-flash');
    assert.equal(official.openai.apiMode, 'responses');
    assert.equal(official.openai.reasoningEffort, 'low');
    assert.equal(official.openai.reviewRequestProfile, null);
    assert.equal(official.fallbackOpenai.model, '', 'a disabled legacy slot cannot inherit a model and become a duplicate attempt');
  }
  assert.deepEqual(baseline.chatTimeouts, { generation: 60000, review: 60000, languageReview: 60000 });
  for (const field of ['baseUrl', 'apiKey', 'apiMode', 'timeoutMs']) {
    assert.equal(baseline.fallbackOpenai[field], baseline.openai[field], `${field} inherits without fallback override`);
  }
  assert.equal(baseline.fallbackOpenai.stream, false);
  const streaming = load({ OPENAI_FALLBACK_STREAM: 'true' });
  assert.equal(streaming.fallbackOpenai.stream, true);
  assert.notEqual(streaming.openai.stream, true);
  assert.notEqual(streaming.venice.stream, true);
  const override = load({ OPENAI_FALLBACK_BASE_URL: 'https://fallback.example.test/v1///',
    OPENAI_FALLBACK_API_MODE: 'chat_completions', OPENAI_FALLBACK_API_KEY: 'fixture-backup', OPENAI_FALLBACK_TIMEOUT_MS: '90000',
    CHAT_REPLY_GENERATION_TIMEOUT_MS: '75000', CHAT_REPLY_REVIEW_TIMEOUT_MS: '65000', CHAT_REPLY_LANGUAGE_REVIEW_TIMEOUT_MS: '55000' });
  assert.equal(override.fallbackOpenai.baseUrl, 'https://fallback.example.test/v1');
  assert.equal(override.fallbackOpenai.apiMode, 'chat_completions');
  assert.equal(override.fallbackOpenai.apiKey, 'fixture-backup');
  assert.equal(override.fallbackOpenai.timeoutMs, 90000);
  assert.equal(override.openai.timeoutMs, 24000, 'chat budgets do not change shared classifier timeout');
  assert.deepEqual(override.chatTimeouts, { generation: 75000, review: 65000, languageReview: 55000 });
  for (const value of ['', ' ', '0', '-1', '120001', 'Infinity', 'NaN', '3.5', 'not-a-number']) {
    const cfg = load({ OPENAI_FALLBACK_TIMEOUT_MS: value, CHAT_REPLY_GENERATION_TIMEOUT_MS: value,
      CHAT_REPLY_REVIEW_TIMEOUT_MS: value, CHAT_REPLY_LANGUAGE_REVIEW_TIMEOUT_MS: value });
    assert.equal(cfg.fallbackOpenai.timeoutMs, 24000);
    assert.deepEqual(cfg.chatTimeouts, baseline.chatTimeouts);
  }
  for (const value of ['1', '120000']) {
    const cfg = load({ OPENAI_FALLBACK_TIMEOUT_MS: value, CHAT_REPLY_GENERATION_TIMEOUT_MS: value });
    assert.equal(cfg.fallbackOpenai.timeoutMs, Number(value));
    assert.equal(cfg.chatTimeouts.generation, Number(value));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('provider configuration self-check passed (isolated fixtures; no network/DB/real keys)');
