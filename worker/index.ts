import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
};

type Variables = {
  authUser: string;
};

type UploadMethod = 'POST' | 'PUT' | 'PATCH';

interface AccountRow {
  id: number;
  account: string;
  password: string;
  clientId: string | null;
  refreshToken: string | null;
  remark: string | null;
  createdAt: string;
}

interface AccountPayload {
  account: string;
  password: string;
  clientId?: string;
  refreshToken?: string;
  remark?: string;
}

interface UploadConfig {
  url: string;
  method: UploadMethod;
  contentType: string;
  headers: string;
  template: string;
  retryCount: number;
  concurrency: number;
  retryDelayMs: number;
}

interface UploadResultDetail {
  id: number;
  account: string;
  ok: boolean;
  status: number;
  response: string;
  attempts: number;
}

interface SessionPayload {
  username: string;
  exp: number;
}

const SESSION_COOKIE_NAME = 'am_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

const DEFAULT_UPLOAD_CONFIG: UploadConfig = {
  url: '',
  method: 'POST',
  contentType: 'application/json',
  headers: '{}',
  template: '{"a":"_account_","p":"_password_"}',
  retryCount: 2,
  concurrency: 3,
  retryDelayMs: 600
};

const ACCOUNT_SELECT_SQL = `
  SELECT
    id,
    account,
    password,
    client_id AS clientId,
    refresh_token AS refreshToken,
    remark,
    created_at AS createdAt
  FROM accounts
`;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors());

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }

  const pathname = new URL(c.req.url).pathname;
  if (isPublicApiPath(pathname)) {
    await next();
    return;
  }

  const authUser = await authenticateRequest(c);
  if (!authUser) {
    throw new HTTPException(401, { message: '未登录或登录已过期' });
  }

  c.set('authUser', authUser);
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/login', async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(c);
  const username = asText(body.username).trim();
  const password = asText(body.password);

  const expectedUsername = getConfiguredUsername(c.env);
  const expectedPassword = getConfiguredPassword(c.env);
  const sessionSecret = getSessionSecret(c.env);

  if (!username || !password) {
    throw new HTTPException(400, { message: '用户名和密码不能为空' });
  }

  if (username !== expectedUsername || !timingSafeEqual(password, expectedPassword)) {
    throw new HTTPException(401, { message: '用户名或密码错误' });
  }

  const token = await createSessionToken(expectedUsername, sessionSecret);
  setCookie(c, SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttpsRequest(c.req.url),
    maxAge: SESSION_MAX_AGE_SECONDS
  });

  return c.json({ ok: true as const, username: expectedUsername });
});

app.get('/api/auth/me', (c) => {
  return c.json({ username: c.get('authUser') });
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: 'Lax',
    secure: isHttpsRequest(c.req.url)
  });
  return c.json({ ok: true as const });
});

app.get('/api/accounts', async (c) => {
  const keyword = (c.req.query('keyword') ?? '').trim();
  let statement: D1PreparedStatement;

  if (keyword) {
    const like = `%${keyword}%`;
    statement = c.env.DB
      .prepare(
        `${ACCOUNT_SELECT_SQL}
         WHERE account LIKE ? OR IFNULL(remark, '') LIKE ?
         ORDER BY id DESC`
      )
      .bind(like, like);
  } else {
    statement = c.env.DB.prepare(`${ACCOUNT_SELECT_SQL} ORDER BY id DESC`);
  }

  const { results } = await statement.all<AccountRow>();
  return c.json({ items: results ?? [] });
});

app.post('/api/accounts', async (c) => {
  const body = await readJson<Partial<AccountPayload>>(c);
  const payload = normalizeAccountPayload(body, true);

  let insertResult: D1Result;
  try {
    insertResult = await c.env.DB
      .prepare(
        `INSERT INTO accounts (account, password, client_id, refresh_token, remark)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        payload.account,
        payload.password,
        payload.clientId,
        payload.refreshToken,
        payload.remark
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: '账号记录已存在' });
    }
    throw error;
  }

  const lastRowId = Number(insertResult.meta.last_row_id);
  const item = await c.env.DB
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`)
    .bind(lastRowId)
    .first<AccountRow>();

  if (!item) {
    throw new HTTPException(500, { message: '账号创建成功，但读取结果失败' });
  }

  return c.json({ item }, 201);
});

app.put('/api/accounts/:id', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const body = await readJson<Partial<AccountPayload>>(c);
  const payload = normalizeAccountPayload(body, true);

  let result: D1Result;
  try {
    result = await c.env.DB
      .prepare(
        `UPDATE accounts
         SET account = ?, password = ?, client_id = ?, refresh_token = ?, remark = ?
         WHERE id = ?`
      )
      .bind(
        payload.account,
        payload.password,
        payload.clientId,
        payload.refreshToken,
        payload.remark,
        id
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: '账号记录已存在' });
    }
    throw error;
  }

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  const item = await c.env.DB
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`)
    .bind(id)
    .first<AccountRow>();

  if (!item) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ item });
});

app.delete('/api/accounts/:id', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ ok: true as const });
});

app.post('/api/accounts/import', async (c) => {
  const body = await readJson<{ text?: string }>(c);
  const text = asText(body.text).trim();
  if (!text) {
    throw new HTTPException(400, { message: '导入内容不能为空' });
  }

  const lines = text.split(/\r?\n/);
  let inserted = 0;
  let skipped = 0;
  const errors: Array<{ line: number; raw: string; reason: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) {
      continue;
    }

    let payload: AccountPayload;
    try {
      payload = parseAccountLine(raw);
    } catch (error) {
      errors.push({
        line: index + 1,
        raw,
        reason: error instanceof Error ? error.message : '格式错误'
      });
      continue;
    }

    try {
      const result = await c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO accounts (account, password, client_id, refresh_token, remark)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          payload.account,
          payload.password,
          toNullableText(payload.clientId),
          toNullableText(payload.refreshToken),
          toNullableText(payload.remark)
        )
        .run();

      if ((result.meta.changes ?? 0) > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors.push({
        line: index + 1,
        raw,
        reason: error instanceof Error ? error.message : '数据库写入失败'
      });
    }
  }

  return c.json({ inserted, skipped, errors });
});

app.get('/api/upload-config', async (c) => {
  const item = await getUploadConfig(c.env.DB);
  return c.json({ item });
});

app.put('/api/upload-config', async (c) => {
  const body = await readJson<Partial<UploadConfig>>(c);
  const item = normalizeUploadConfig(body);
  validateUploadConfig(item);

  await c.env.DB
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('upload_config', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key)
       DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .bind(JSON.stringify(item))
    .run();

  return c.json({ item });
});

app.post('/api/upload/execute', async (c) => {
  const body = await readJson<{ accountIds?: unknown }>(c);
  const accountIds = parseAccountIds(body.accountIds);
  const config = await getUploadConfig(c.env.DB);
  validateUploadConfig(config);

  if (!config.url) {
    throw new HTTPException(400, { message: '请先配置上传 URL' });
  }

  const accounts =
    accountIds.length > 0
      ? await fetchAccountsByIds(c.env.DB, accountIds)
      : await fetchAllAccounts(c.env.DB);

  if (accounts.length === 0) {
    throw new HTTPException(400, { message: '没有可上传的账号' });
  }

  const baseHeaders = parseHeaders(config.headers);
  if (!hasHeader(baseHeaders, 'Content-Type')) {
    baseHeaders['Content-Type'] = config.contentType;
  }

  const template = parseTemplate(config.template);
  const details = await mapWithConcurrency(accounts, config.concurrency, async (account) =>
    uploadAccountWithRetry(account, config, baseHeaders, template)
  );

  const success = details.filter((item) => item.ok).length;
  return c.json({
    total: details.length,
    success,
    failure: details.length - success,
    details
  });
});

app.all('*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname.startsWith('/api/')) {
    return c.json({ message: '接口不存在' }, 404);
  }

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  if (assetResponse.status !== 404 || c.req.method !== 'GET') {
    return assetResponse;
  }

  const indexUrl = new URL(c.req.url);
  indexUrl.pathname = '/index.html';
  const indexRequest = new Request(indexUrl.toString(), {
    method: 'GET',
    headers: c.req.raw.headers
  });
  return c.env.ASSETS.fetch(indexRequest);
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ message: error.message }, error.status);
  }

  console.error(error);
  return c.json({ message: '服务器内部错误' }, 500);
});

export default app;

async function readJson<T>(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: '请求体必须是合法 JSON' });
  }
}

function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function toNullableText(value: unknown): string | null {
  const text = asText(value).trim();
  return text ? text : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /unique/i.test(error.message);
}

function parseNumericId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: 'ID 非法' });
  }
  return id;
}

function normalizeAccountPayload(input: Partial<AccountPayload>, requireBase: boolean): AccountPayload {
  const account = asText(input.account).trim();
  const password = asText(input.password).trim();

  if (requireBase && (!account || !password)) {
    throw new HTTPException(400, { message: '账号和密码不能为空' });
  }

  const payload: AccountPayload = {
    account,
    password,
    clientId: asText(input.clientId).trim(),
    refreshToken: asText(input.refreshToken).trim(),
    remark: asText(input.remark).trim()
  };

  if (payload.account.length > 255 || payload.password.length > 255) {
    throw new HTTPException(400, { message: '账号或密码长度超过限制' });
  }

  return payload;
}

function parseAccountLine(line: string): AccountPayload {
  const parts = line.split('----').map((item) => item.trim());
  if (parts.length < 2 || parts.length > 4) {
    throw new Error('格式应为 账号----密码 或 账号----密码----client_id----refresh_token');
  }

  const [account, password, clientId = '', refreshToken = ''] = parts;
  if (!account || !password) {
    throw new Error('账号和密码不能为空');
  }

  return {
    account,
    password,
    clientId,
    refreshToken,
    remark: ''
  };
}

function normalizeUploadConfig(input: Partial<UploadConfig>): UploadConfig {
  const methodRaw = asText(input.method).trim().toUpperCase();
  const method: UploadMethod = ['POST', 'PUT', 'PATCH'].includes(methodRaw)
    ? (methodRaw as UploadMethod)
    : DEFAULT_UPLOAD_CONFIG.method;

  const contentType = asText(input.contentType).trim() || DEFAULT_UPLOAD_CONFIG.contentType;
  const headers = asText(input.headers).trim() || DEFAULT_UPLOAD_CONFIG.headers;
  const template = asText(input.template).trim() || DEFAULT_UPLOAD_CONFIG.template;
  const retryCount = parseInteger(input.retryCount, DEFAULT_UPLOAD_CONFIG.retryCount);
  const concurrency = parseInteger(input.concurrency, DEFAULT_UPLOAD_CONFIG.concurrency);
  const retryDelayMs = parseInteger(input.retryDelayMs, DEFAULT_UPLOAD_CONFIG.retryDelayMs);

  return {
    url: asText(input.url).trim(),
    method,
    contentType,
    headers,
    template,
    retryCount,
    concurrency,
    retryDelayMs
  };
}

async function getUploadConfig(db: D1Database): Promise<UploadConfig> {
  const row = await db
    .prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1')
    .bind('upload_config')
    .first<{ value: string }>();

  if (!row?.value) {
    return DEFAULT_UPLOAD_CONFIG;
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<UploadConfig>;
    return normalizeUploadConfig(parsed);
  } catch {
    return DEFAULT_UPLOAD_CONFIG;
  }
}

function validateUploadConfig(config: UploadConfig): void {
  if (config.url) {
    try {
      const url = new URL(config.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('URL 协议必须为 http 或 https');
      }
    } catch {
      throw new HTTPException(400, { message: '上传 URL 格式错误' });
    }
  }

  if (!Number.isInteger(config.retryCount) || config.retryCount < 0 || config.retryCount > 5) {
    throw new HTTPException(400, { message: '重试次数范围必须在 0 到 5 之间' });
  }

  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 10) {
    throw new HTTPException(400, { message: '并发数范围必须在 1 到 10 之间' });
  }

  if (!Number.isInteger(config.retryDelayMs) || config.retryDelayMs < 0 || config.retryDelayMs > 10000) {
    throw new HTTPException(400, { message: '重试间隔范围必须在 0 到 10000 毫秒之间' });
  }

  parseHeaders(config.headers);
  parseTemplate(config.template);
}

function parseHeaders(input: string): Record<string, string> {
  const text = input.trim();
  if (!text) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: '请求头必须是 JSON 格式' });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HTTPException(400, { message: '请求头必须是 JSON 对象' });
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    headers[key] = asText(value);
  }

  return headers;
}

function parseTemplate(input: string): unknown {
  const text = input.trim();
  if (!text) {
    throw new HTTPException(400, { message: '数据模板不能为空' });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: '数据模板必须是合法 JSON' });
  }
}

function parseInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const text = asText(value).trim();
  if (!text) {
    return fallback;
  }

  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAccountIds(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const ids = input
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return Array.from(new Set(ids));
}

async function fetchAllAccounts(db: D1Database): Promise<AccountRow[]> {
  const { results } = await db.prepare(`${ACCOUNT_SELECT_SQL} ORDER BY id DESC`).all<AccountRow>();
  return results ?? [];
}

async function fetchAccountsByIds(db: D1Database, ids: number[]): Promise<AccountRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(',');
  const statement = db
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id IN (${placeholders}) ORDER BY id DESC`)
    .bind(...ids);
  const { results } = await statement.all<AccountRow>();
  return results ?? [];
}

function hasHeader(headers: Record<string, string>, target: string): boolean {
  const targetLower = target.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === targetLower);
}

function fillTemplate(template: unknown, account: AccountRow): unknown {
  if (typeof template === 'string') {
    return fillTemplateString(template, account);
  }

  if (Array.isArray(template)) {
    return template.map((item) => fillTemplate(item, account));
  }

  if (template && typeof template === 'object') {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      mapped[key] = fillTemplate(value, account);
    }
    return mapped;
  }

  return template;
}

function fillTemplateString(template: string, account: AccountRow): string {
  return template
    .replaceAll('_account_', account.account)
    .replaceAll('_password_', account.password)
    .replaceAll('_id_', account.clientId ?? '')
    .replaceAll('_token_', account.refreshToken ?? '')
    .replaceAll('captchaurn', toCaptchaUrn(account));
}

function toCaptchaUrn(account: AccountRow): string {
  if (!account.clientId && !account.refreshToken) {
    return `${account.account}----${account.password}`;
  }

  return `${account.account}----${account.password}----${account.clientId ?? ''}----${account.refreshToken ?? ''}`;
}

function buildRequestBody(payload: unknown, contentType: string): string {
  const lowerType = contentType.toLowerCase();

  if (lowerType.includes('application/json')) {
    return JSON.stringify(payload);
  }

  if (lowerType.includes('application/x-www-form-urlencoded')) {
    return toUrlEncoded(payload);
  }

  if (typeof payload === 'string') {
    return payload;
  }

  return JSON.stringify(payload);
}

function toUrlEncoded(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return new URLSearchParams({ data: asText(payload) }).toString();
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      params.set(key, '');
    } else if (typeof value === 'string') {
      params.set(key, value);
    } else {
      params.set(key, JSON.stringify(value));
    }
  }

  return params.toString();
}

async function uploadAccountWithRetry(
  account: AccountRow,
  config: UploadConfig,
  baseHeaders: Record<string, string>,
  template: unknown
): Promise<UploadResultDetail> {
  const payload = fillTemplate(template, account);
  const maxAttempts = config.retryCount + 1;
  let lastStatus = 0;
  let lastResponse = '请求失败';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(config.url, {
        method: config.method,
        headers: new Headers(baseHeaders),
        body: buildRequestBody(payload, config.contentType)
      });

      const responseText = truncate(await response.text(), 600) || '(empty body)';
      if (response.ok) {
        return {
          id: account.id,
          account: account.account,
          ok: true,
          status: response.status,
          response: responseText,
          attempts: attempt
        };
      }

      lastStatus = response.status;
      lastResponse = responseText;
    } catch (error) {
      lastStatus = 0;
      lastResponse = truncate(error instanceof Error ? error.message : '请求异常', 600);
    }

    if (attempt < maxAttempts && config.retryDelayMs > 0) {
      await sleep(config.retryDelayMs);
    }
  }

  return {
    id: account.id,
    account: account.account,
    ok: false,
    status: lastStatus,
    response: lastResponse,
    attempts: maxAttempts
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        break;
      }

      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function truncate(input: string, limit: number): string {
  if (input.length <= limit) {
    return input;
  }
  return `${input.slice(0, limit)}...`;
}

function isPublicApiPath(pathname: string): boolean {
  return pathname === '/api/health' || pathname === '/api/auth/login';
}

async function authenticateRequest(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const secret = getSessionSecret(c.env);
  const session = await verifySessionToken(token, secret);
  if (!session) {
    return null;
  }

  return session.username;
}

function getConfiguredUsername(env: Bindings): string {
  return asText(env.ADMIN_USERNAME).trim() || 'admin';
}

function getConfiguredPassword(env: Bindings): string {
  const password = asText(env.ADMIN_PASSWORD);
  if (!password) {
    throw new HTTPException(500, {
      message: '服务端未配置 ADMIN_PASSWORD，请执行 wrangler secret put ADMIN_PASSWORD'
    });
  }
  return password;
}

function getSessionSecret(env: Bindings): string {
  const secret = asText(env.SESSION_SECRET);
  if (!secret) {
    throw new HTTPException(500, {
      message: '服务端未配置 SESSION_SECRET，请执行 wrangler secret put SESSION_SECRET'
    });
  }
  return secret;
}

async function createSessionToken(username: string, secret: string): Promise<string> {
  const payload: SessionPayload = {
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  };

  const encodedPayload = encodeBase64UrlText(JSON.stringify(payload));
  const signature = await signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signValue(encodedPayload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: Partial<SessionPayload>;
  try {
    payload = JSON.parse(decodeBase64UrlText(encodedPayload)) as Partial<SessionPayload>;
  } catch {
    return null;
  }

  if (typeof payload.username !== 'string' || typeof payload.exp !== 'number') {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    username: payload.username,
    exp: payload.exp
  };
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return encodeBase64UrlBytes(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function encodeBase64UrlText(input: string): string {
  return encodeBase64UrlBytes(textEncoder.encode(input));
}

function decodeBase64UrlText(input: string): string {
  return textDecoder.decode(decodeBase64UrlBytes(input));
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64UrlBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = base64.length % 4;
  const padded = paddingLength === 0 ? base64 : `${base64}${'='.repeat(4 - paddingLength)}`;
  const binary = atob(padded);

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isHttpsRequest(url: string): boolean {
  return new URL(url).protocol === 'https:';
}
