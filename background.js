const STORAGE_KEYS = {
  connectionCount: 'connectionCount',
  customMessage: 'customMessage',
  followList: 'followList',
  lastRunStatus: 'lastRunStatus',
  debugMode: 'debugMode',
  followExportMeta: 'followExportMeta',
  rateLimits: 'rateLimits',
  inviteRateState: 'inviteRateState',
  followRetryBatch: 'followRetryBatch',
  inmailDraft: 'inmailDraft',
  inmailBatch: 'inmailBatch',
  apiConfig: 'apiConfig',
  apiEventQueue: 'apiEventQueue',
  analytics: 'analytics',
  stopStats: 'stopStats',
  followRetrySettings: 'followRetrySettings',
  observability: 'observability',
};
const RUN_STATES = {
  idle: 'idle',
  running: 'running',
  stopped: 'stopped',
  finished: 'finished',
};

const FOLLOW_SCHEMA_VERSION = 2;
const INMAIL_BATCH_VERSION = 1;
const FOLLOW_RETRY_BATCH_VERSION = 1;
const API_QUEUE_VERSION = 1;
const API_SYNC_ENABLED = false;
const OBSERVABILITY_VERSION = 1;
const MAX_OBSERVABILITY_EVENTS = 3000;
const quotaByTabId = new Map();
const LINKEDIN_INVITE_API_HINTS = [
  'voyagerRelationshipsDashMemberRelationships',
  'verifyQuotaAndCreateV2',
  '/voyager/api/growth/norminvitations',
  '/voyager/api/relationships',
];
const LINKEDIN_INVITE_API_KEYWORDS = ['invite', 'invitation', 'relationship', 'connect', 'quota'];

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLinkedInInviteQuotaUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u.includes('linkedin.com')) return false;
  if (LINKEDIN_INVITE_API_HINTS.some((hint) => u.includes(String(hint).toLowerCase()))) return true;
  if (!u.includes('/voyager/api/')) return false;
  return LINKEDIN_INVITE_API_KEYWORDS.some((keyword) => u.includes(keyword));
}

function resetQuotaFlagForTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  quotaByTabId.set(tabId, false);
}

function normalizeLinkedinLimitReason(reason) {
  const text = String(reason || '').trim().toLowerCase();
  if (text === 'linkedin_limit_reached_429' || text === 'api_429' || text === 'linkedin_limit_api_429') {
    return 'linkedin_limit_reached_429';
  }
  if (text === 'linkedin_limit_reached' || text === 'ui_limit' || text.includes('linkedin_limit')) {
    return 'linkedin_limit_reached';
  }
  return '';
}

function isLinkedInTab(tab) {
  return !!tab?.url && String(tab.url).startsWith('https://www.linkedin.com');
}

function normalizeRunState(state) {
  const normalized = String(state || '').trim().toLowerCase();
  return RUN_STATES[normalized] || RUN_STATES.idle;
}

function normalizeFinishReason(rawReason) {
  const reason = String(rawReason || '').trim();
  return reason || 'finished';
}

function buildLastRunStatus(state, payload = {}) {
  const finishReason = normalizeFinishReason(payload.finishReason || payload.reason || '');
  return {
    state: normalizeRunState(state),
    finishReason: payload.state === RUN_STATES.running ? '' : finishReason,
    // Compatibilidad retro para consumidores existentes.
    reason: payload.state === RUN_STATES.running ? '' : finishReason,
    sentThisSession: Number(payload.sentThisSession || 0),
    limit: Number(payload.limit || 0),
    detail: String(payload.detail || ''),
    at: Date.now(),
  };
}

function normalizeLastRunStatus(raw) {
  const state = normalizeRunState(raw?.state);
  const finishReason = state === RUN_STATES.running ? '' : normalizeFinishReason(raw?.finishReason || raw?.reason || '');
  return {
    state,
    finishReason,
    reason: finishReason,
    sentThisSession: Number(raw?.sentThisSession || 0),
    limit: Number(raw?.limit || 0),
    detail: String(raw?.detail || ''),
    at: Number(raw?.at || 0) || Date.now(),
  };
}

function canTransitionRunState(fromState, toState) {
  const from = normalizeRunState(fromState);
  const to = normalizeRunState(toState);
  if (from === to) return true;
  const validTransitions = {
    [RUN_STATES.idle]: [RUN_STATES.running],
    [RUN_STATES.running]: [RUN_STATES.stopped, RUN_STATES.finished],
    [RUN_STATES.stopped]: [RUN_STATES.running],
    [RUN_STATES.finished]: [RUN_STATES.running],
  };
  return (validTransitions[from] || []).includes(to);
}

async function transitionLastRunStatus(targetState, payload = {}) {
  const data = await getStorage([STORAGE_KEYS.lastRunStatus]);
  const current = normalizeLastRunStatus(data[STORAGE_KEYS.lastRunStatus]);
  const toState = normalizeRunState(targetState);
  if (!canTransitionRunState(current.state, toState)) {
    return { ok: false, current };
  }
  const next = buildLastRunStatus(toState, { ...payload, state: toState });
  await setStorage({ [STORAGE_KEYS.lastRunStatus]: next });
  return { ok: true, current, next };
}

function canonicalizeLinkedinUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  // Si viene una fila completa o texto extra, intenta extraer la primera URL de LinkedIn.
  const match = raw.match(/https?:\/\/[^\s,"']*linkedin\.com[^\s,"']*/i);
  const candidate = match ? match[0] : raw;
  try {
    const parsed = new URL(
      candidate.startsWith('http')
        ? candidate
        : `https://www.linkedin.com${candidate.startsWith('/') ? '' : '/'}${candidate}`
    );
    if (!parsed.hostname.includes('linkedin.com')) return '';
    let path = parsed.pathname || '';
    if (!path.includes('/in/')) return '';
    path = path.replace(/\/+$/, '');
    return `https://www.linkedin.com${path}`.toLowerCase();
  } catch (_) {
    return '';
  }
}

function normalizeFollowEntry(entry) {
  const profileUrl = canonicalizeLinkedinUrl(entry?.profile_url || entry?.url || '');
  if (!profileUrl) return null;
  return {
    id: entry?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    schema_version: FOLLOW_SCHEMA_VERSION,
    profile_url: profileUrl,
    full_name: String(entry?.full_name || entry?.name || '').trim(),
    headline: String(entry?.headline || '').trim(),
    location: String(entry?.location || '').trim(),
    query: String(entry?.query || '').trim(),
    page: Number.isFinite(Number(entry?.page)) ? Number(entry.page) : 0,
    detected_at: entry?.detected_at || entry?.date || new Date().toISOString(),
    status: String(entry?.status || 'follow_detected'),
    exported_at: entry?.exported_at || null,
  };
}

function normalizeApiConfig(raw) {
  return {
    enabled: !!raw?.enabled,
    baseUrl: String(raw?.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(raw?.apiKey || '').trim(),
  };
}

function createRunId(prefix = 'run') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeObservability(raw) {
  return {
    version: OBSERVABILITY_VERSION,
    active: {
      connectRunId: String(raw?.active?.connectRunId || ''),
      followRetryRunId: String(raw?.active?.followRetryRunId || ''),
      inmailRunId: String(raw?.active?.inmailRunId || ''),
    },
    events: Array.isArray(raw?.events) ? raw.events : [],
  };
}

function pickDiagPayload(rawPayload = {}) {
  const input = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const safe = {};
  const allowed = ['action', 'attempt', 'maxAttempts', 'reason', 'status', 'cursor', 'total', 'scope'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      safe[key] = input[key];
    }
  }
  return safe;
}

async function appendDiagEvent(event = {}) {
  const data = await getStorage([STORAGE_KEYS.observability]);
  const obs = normalizeObservability(data[STORAGE_KEYS.observability]);
  const item = {
    id: createRunId('evt'),
    at: new Date().toISOString(),
    scope: String(event.scope || 'system'),
    stage: String(event.stage || 'info'),
    runId: String(event.runId || ''),
    source: String(event.source || ''),
    reason: String(event.reason || ''),
    detail: String(event.detail || ''),
    payload: pickDiagPayload(event.payload || {}),
  };
  obs.events.push(item);
  if (obs.events.length > MAX_OBSERVABILITY_EVENTS) {
    obs.events = obs.events.slice(obs.events.length - MAX_OBSERVABILITY_EVENTS);
  }
  await setStorage({ [STORAGE_KEYS.observability]: obs });
}

async function setActiveRunId(scope, runId) {
  const data = await getStorage([STORAGE_KEYS.observability]);
  const obs = normalizeObservability(data[STORAGE_KEYS.observability]);
  if (scope === 'connect_loop') obs.active.connectRunId = String(runId || '');
  if (scope === 'follow_retry') obs.active.followRetryRunId = String(runId || '');
  if (scope === 'inmail_batch') obs.active.inmailRunId = String(runId || '');
  await setStorage({ [STORAGE_KEYS.observability]: obs });
}

function createApiEvent(type, payload = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextRetryAt: Date.now(),
  };
}

async function enqueueApiEvent(type, payload = {}) {
  if (!API_SYNC_ENABLED) return;
  const data = await getStorage([STORAGE_KEYS.apiEventQueue]);
  const queue = data[STORAGE_KEYS.apiEventQueue] || { version: API_QUEUE_VERSION, items: [] };
  queue.items = Array.isArray(queue.items) ? queue.items : [];
  queue.items.push(createApiEvent(type, payload));
  if (queue.items.length > 1000) {
    queue.items = queue.items.slice(queue.items.length - 1000);
  }
  await setStorage({ [STORAGE_KEYS.apiEventQueue]: queue });
}

let apiSyncRunning = false;
async function flushApiQueue(maxItems = 30) {
  if (!API_SYNC_ENABLED) return;
  if (apiSyncRunning) return;
  apiSyncRunning = true;
  try {
    const data = await getStorage([STORAGE_KEYS.apiConfig, STORAGE_KEYS.apiEventQueue]);
    const apiConfig = normalizeApiConfig(data[STORAGE_KEYS.apiConfig]);
    const queue = data[STORAGE_KEYS.apiEventQueue] || { version: API_QUEUE_VERSION, items: [] };
    queue.items = Array.isArray(queue.items) ? queue.items : [];
    if (!apiConfig.enabled || !apiConfig.baseUrl || !apiConfig.apiKey || queue.items.length === 0) {
      return;
    }
    const now = Date.now();
    const pending = queue.items.filter((item) => Number(item?.nextRetryAt || 0) <= now).slice(0, maxItems);
    if (pending.length === 0) return;

    for (const item of pending) {
      try {
        const response = await fetch(`${apiConfig.baseUrl}/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiConfig.apiKey}`,
          },
          body: JSON.stringify({
            event_id: item.id,
            event_type: item.type,
            created_at: item.createdAt,
            payload: item.payload || {},
          }),
        });
        if (!response.ok) {
          throw new Error(`api_http_${response.status}`);
        }
        queue.items = queue.items.filter((it) => it.id !== item.id);
      } catch (_) {
        const target = queue.items.find((it) => it.id === item.id);
        if (!target) continue;
        target.attempts = Number(target.attempts || 0) + 1;
        const backoffMs = Math.min(15 * 60 * 1000, 1500 * Math.pow(2, Math.min(target.attempts, 6)));
        target.nextRetryAt = Date.now() + backoffMs;
      }
    }
    await setStorage({ [STORAGE_KEYS.apiEventQueue]: queue });
  } finally {
    apiSyncRunning = false;
  }
}

function getRunDateKey(input = new Date()) {
  const d = new Date(input);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function addStopStat(reason, detail = '') {
  const data = await getStorage([STORAGE_KEYS.stopStats]);
  const current = data[STORAGE_KEYS.stopStats] || { total: 0, byReason: {}, lastStopAt: null, lastDetail: '' };
  const safeReason = String(reason || 'unknown_stop');
  current.total = Number(current.total || 0) + 1;
  current.byReason = current.byReason || {};
  current.byReason[safeReason] = Number(current.byReason[safeReason] || 0) + 1;
  current.lastStopAt = new Date().toISOString();
  current.lastDetail = String(detail || '');
  await setStorage({ [STORAGE_KEYS.stopStats]: current });
}

async function addAnalyticsEvent(type, payload = {}) {
  const data = await getStorage([STORAGE_KEYS.analytics]);
  const current = data[STORAGE_KEYS.analytics] || {
    events: [],
    counters: {
      detected: 0,
      connect_available: 0,
      invited: 0,
      invite_failed: 0,
      accepted: 0,
    },
  };
  const event = {
    type: String(type || ''),
    at: new Date().toISOString(),
    payload,
  };
  current.events = Array.isArray(current.events) ? current.events : [];
  current.events.push(event);
  if (current.events.length > 2000) {
    current.events = current.events.slice(current.events.length - 2000);
  }
  current.counters = current.counters || {};
  if (type === 'lead_detected') current.counters.detected = Number(current.counters.detected || 0) + 1;
  if (type === 'connect_available') current.counters.connect_available = Number(current.counters.connect_available || 0) + 1;
  if (type === 'invite_sent') current.counters.invited = Number(current.counters.invited || 0) + 1;
  if (type === 'invite_failed') current.counters.invite_failed = Number(current.counters.invite_failed || 0) + 1;
  if (type === 'accepted') current.counters.accepted = Number(current.counters.accepted || 0) + 1;
  await setStorage({ [STORAGE_KEYS.analytics]: current });
}

function calculateSimpleScore(entry, settings) {
  const text = `${entry?.headline || ''} ${entry?.location || ''} ${entry?.query || ''}`.toLowerCase();
  const keywords = String(settings?.scoreKeywords || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score += 10;
  }
  return score;
}

function matchListRule(url, ruleCsv) {
  const rules = String(ruleCsv || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return false;
  const u = String(url || '').toLowerCase();
  return rules.some((rule) => u.includes(rule));
}

function dedupeFollowEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const normalized = normalizeFollowEntry(entry);
    if (!normalized) continue;
    if (seen.has(normalized.profile_url)) continue;
    seen.add(normalized.profile_url);
    out.push(normalized);
  }
  return out;
}

function getDayKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getHourKey(date = new Date()) {
  return `${getDayKey(date)}T${String(date.getUTCHours()).padStart(2, '0')}`;
}

function normalizeRateLimits(raw) {
  const hour = Number.parseInt(raw?.hour || raw?.hourLimit || 0, 10);
  const day = Number.parseInt(raw?.day || raw?.dayLimit || 0, 10);
  return {
    hour: Number.isFinite(hour) && hour > 0 ? hour : 0,
    day: Number.isFinite(day) && day > 0 ? day : 0,
  };
}

function normalizeInviteRateState(raw) {
  const now = new Date();
  const dayKey = getDayKey(now);
  const hourKey = getHourKey(now);
  const state = {
    dayKey: raw?.dayKey || dayKey,
    dayCount: Number.isFinite(Number(raw?.dayCount)) ? Number(raw.dayCount) : 0,
    hourKey: raw?.hourKey || hourKey,
    hourCount: Number.isFinite(Number(raw?.hourCount)) ? Number(raw.hourCount) : 0,
  };
  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.dayCount = 0;
  }
  if (state.hourKey !== hourKey) {
    state.hourKey = hourKey;
    state.hourCount = 0;
  }
  return state;
}

function checkRateLimit(rateState, rateLimits) {
  if (rateLimits.hour > 0 && rateState.hourCount >= rateLimits.hour) {
    return { allowed: false, reason: 'hour_limit_reached' };
  }
  if (rateLimits.day > 0 && rateState.dayCount >= rateLimits.day) {
    return { allowed: false, reason: 'day_limit_reached' };
  }
  return { allowed: true, reason: '' };
}

async function ensureStorageMigration() {
  const data = await getStorage([
    STORAGE_KEYS.followList,
    STORAGE_KEYS.followExportMeta,
    STORAGE_KEYS.rateLimits,
    STORAGE_KEYS.inviteRateState,
    STORAGE_KEYS.followRetryBatch,
    STORAGE_KEYS.inmailBatch,
    STORAGE_KEYS.apiConfig,
    STORAGE_KEYS.apiEventQueue,
    STORAGE_KEYS.analytics,
    STORAGE_KEYS.stopStats,
    STORAGE_KEYS.followRetrySettings,
    STORAGE_KEYS.observability,
  ]);
  const migratedFollowList = dedupeFollowEntries(data[STORAGE_KEYS.followList] || []);
  const update = {};
  if (JSON.stringify(migratedFollowList) !== JSON.stringify(data[STORAGE_KEYS.followList] || [])) {
    update[STORAGE_KEYS.followList] = migratedFollowList;
  }
  if (!data[STORAGE_KEYS.followExportMeta]) {
    update[STORAGE_KEYS.followExportMeta] = { lastExportAt: null };
  }
  if (!data[STORAGE_KEYS.rateLimits]) {
    update[STORAGE_KEYS.rateLimits] = { hour: 0, day: 0 };
  }
  if (!data[STORAGE_KEYS.inviteRateState]) {
    update[STORAGE_KEYS.inviteRateState] = normalizeInviteRateState({});
  } else {
    const normalizedRateState = normalizeInviteRateState(data[STORAGE_KEYS.inviteRateState]);
    if (JSON.stringify(normalizedRateState) !== JSON.stringify(data[STORAGE_KEYS.inviteRateState])) {
      update[STORAGE_KEYS.inviteRateState] = normalizedRateState;
    }
  }
  if (!data[STORAGE_KEYS.followRetryBatch]) {
    update[STORAGE_KEYS.followRetryBatch] = {
      version: FOLLOW_RETRY_BATCH_VERSION,
      status: 'idle',
      rows: [],
      cursor: 0,
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      startedAt: null,
      finishedAt: null,
      stopRequested: false,
      tabId: null,
    };
  }
  if (!data[STORAGE_KEYS.inmailBatch]) {
    update[STORAGE_KEYS.inmailBatch] = {
      version: INMAIL_BATCH_VERSION,
      status: 'idle',
      rows: [],
      cursor: 0,
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      duplicatesRemoved: 0,
      startedAt: null,
      finishedAt: null,
      stopRequested: false,
      tabId: null,
    };
  }
  if (!data[STORAGE_KEYS.apiConfig]) {
    update[STORAGE_KEYS.apiConfig] = { enabled: false, baseUrl: '', apiKey: '' };
  } else {
    update[STORAGE_KEYS.apiConfig] = normalizeApiConfig(data[STORAGE_KEYS.apiConfig]);
  }
  if (!data[STORAGE_KEYS.apiEventQueue]) {
    update[STORAGE_KEYS.apiEventQueue] = { version: API_QUEUE_VERSION, items: [] };
  }
  if (!data[STORAGE_KEYS.analytics]) {
    update[STORAGE_KEYS.analytics] = {
      events: [],
      counters: { detected: 0, connect_available: 0, invited: 0, invite_failed: 0, accepted: 0 },
    };
  }
  if (!data[STORAGE_KEYS.stopStats]) {
    update[STORAGE_KEYS.stopStats] = { total: 0, byReason: {}, lastStopAt: null, lastDetail: '' };
  }
  if (!data[STORAGE_KEYS.followRetrySettings]) {
    update[STORAGE_KEYS.followRetrySettings] = { scoreKeywords: '', whitelist: '', blacklist: '' };
  }
  if (!data[STORAGE_KEYS.observability]) {
    update[STORAGE_KEYS.observability] = normalizeObservability({});
  }
  if (Object.keys(update).length > 0) {
    await setStorage(update);
  }
}

function parseCsvLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols.map((v) => v.trim());
}

function parseInmailCsv(csvText) {
  const lines = String(csvText || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], duplicatesRemoved: 0, error: 'CSV vacío o sin filas de datos.' };
  }
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const urlIdx = header.findIndex((h) => ['profile_url', 'url', 'linkedin_url', 'linkedin profile', 'perfil'].includes(h));
  const nameIdx = header.findIndex((h) => ['full_name', 'name', 'nombre'].includes(h));
  if (urlIdx < 0) {
    return { rows: [], duplicatesRemoved: 0, error: 'El CSV debe incluir columna URL/profile_url.' };
  }
  const unique = new Set();
  const rows = [];
  let duplicatesRemoved = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const canonical = canonicalizeLinkedinUrl(cols[urlIdx] || '');
    if (!canonical) continue;
    if (unique.has(canonical)) {
      duplicatesRemoved++;
      continue;
    }
    unique.add(canonical);
    rows.push({
      row: i + 1,
      profile_url: canonical,
      full_name: (nameIdx >= 0 ? cols[nameIdx] : '') || '',
      status: 'PENDING',
      reason: '',
      updated_at: null,
    });
  }
  return { rows, duplicatesRemoved, error: '' };
}

async function persistFollowRetryResults(batch) {
  if (!batch?.rows?.length) return;
  const data = await getStorage([STORAGE_KEYS.followList]);
  const list = dedupeFollowEntries(data[STORAGE_KEYS.followList] ?? []);
  const byUrl = new Map(batch.rows.map((row) => [canonicalizeLinkedinUrl(row.profile_url), row]));
  const updated = list.map((entry) => {
    const match = byUrl.get(canonicalizeLinkedinUrl(entry.profile_url));
    if (!match) return entry;
    let status = entry.status;
    if (match.status === 'SENT') status = 'invite_sent';
    else if (match.status === 'SKIPPED') status = 'connect_not_available';
    else if (match.status === 'FAILED') status = 'invite_failed';
    return {
      ...entry,
      status,
      updated_at: match.updated_at || new Date().toISOString(),
      last_reason: match.reason || '',
    };
  });
  await setStorage({ [STORAGE_KEYS.followList]: updated });
}

function queryActiveTab() {
  return new Promise((resolve) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs[0] || null)));
}

function updateTabUrl(tabId, url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function waitTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
    function listener(updatedTabId, info) {
      if (updatedTabId !== tabId) return;
      if (info.status === 'complete') {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function getTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(tab || null);
    });
  });
}

async function waitForTabLinkedInReady(tabId, expectedUrl, timeoutMs = 60000) {
  const startedAt = Date.now();
  const expected = canonicalizeLinkedinUrl(expectedUrl || '');
  let stablePasses = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await getTab(tabId);
    if (!tab?.id) return false;
    const tabUrl = canonicalizeLinkedinUrl(tab.url || '');
    const urlMatches = expected ? tabUrl === expected : !!tabUrl;
    const complete = tab.status === 'complete';
    if (urlMatches && complete) {
      stablePasses++;
      if (stablePasses >= 2) return true;
    } else {
      stablePasses = 0;
    }
    await sleep(900);
  }
  return false;
}

function sendMessageToTab(tabId, message, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Timeout enviando mensaje al content script.'));
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || null);
    });
  });
}

function classifyTabMessageError(err) {
  const text = String(err?.message || err || '').toLowerCase();
  if (
    text.includes('no tab with id') ||
    text.includes('tab was closed') ||
    text.includes('tabs cannot be edited right now')
  ) {
    return { retryable: false, reason: 'tab_not_available', text };
  }
  if (text.includes('receiving end does not exist') || text.includes('could not establish connection')) {
    return { retryable: true, reason: 'content_script_not_ready', text };
  }
  if (
    text.includes('message channel closed') ||
    text.includes('the message port closed before a response was received') ||
    text.includes('a listener indicated an asynchronous response')
  ) {
    return { retryable: true, reason: 'message_channel_closed', text };
  }
  if (text.includes('timeout enviando mensaje al content script') || text.includes('timeout enviando mensaje')) {
    return { retryable: true, reason: 'tab_message_timeout', text };
  }
  return { retryable: false, reason: 'content_message_error', text };
}

function isTransientTabMessageError(err) {
  return classifyTabMessageError(err).retryable;
}

function getTabMessageErrorReason(err, fallback = 'content_message_error') {
  const explicitCode = String(err?.code || '').trim();
  if (explicitCode) return explicitCode;
  const rawMessage = String(err?.message || '').trim().toLowerCase();
  if (/^[a-z0-9_]+$/.test(rawMessage)) return rawMessage;
  return classifyTabMessageError(err).reason || fallback;
}

function isRetryableBatchReason(reason) {
  const text = String(reason || '').toLowerCase();
  if (!text) return false;
  return (
    text === 'message_channel_closed' ||
    text === 'tab_message_timeout' ||
    text.includes('profile_not_ready') ||
    text.includes('content_script_not_ready') ||
    text.includes('tab_not_ready_timeout') ||
    text.includes('tab_complete_timeout') ||
    text.includes('blocking_overlay_active') ||
    text.includes('composer_send_not_found') ||
    text.includes('composer_not_found') ||
    text.includes('message_field_not_found') ||
    text.includes('message_button_not_found')
  );
}

function normalizeBatchRowOutcome(response, fallbackReason = 'unknown') {
  const rawStatus = String(response?.status || '').toUpperCase();
  const reason = String(response?.reason || '').trim();
  if (rawStatus === 'SENT') return { status: 'SENT', reason: '' };
  if (rawStatus === 'SKIPPED') return { status: 'SKIPPED', reason: reason || 'skipped' };
  if (rawStatus === 'FAILED') return { status: 'FAILED', reason: reason || fallbackReason };
  if (rawStatus === 'STOPPED') return { status: 'FAILED', reason: reason || 'stopped' };
  return { status: 'FAILED', reason: reason || fallbackReason };
}

async function sendMessageToTabWithRetry(tabId, message, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 1));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
  const retryDelayMs = Math.max(200, Number(options.retryDelayMs || 700));
  const scope = String(options.scope || 'system');
  const runId = String(options.runId || '');
  let lastReason = 'content_message_error';
  let lastMessage = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendMessageToTab(tabId, message, timeoutMs);
    } catch (err) {
      const classified = classifyTabMessageError(err);
      lastReason = classified.reason || 'content_message_error';
      lastMessage = String(err?.message || '');
      if (classified.retryable && attempt < maxAttempts) {
        await appendDiagEvent({
          scope,
          runId,
          stage: 'retry',
          source: 'sendMessageToTabWithRetry',
          reason: lastReason,
          payload: {
            action: message?.action || '',
            attempt,
            maxAttempts,
            reason: lastReason,
            scope,
          },
        });
      }
      if (lastReason === 'tab_message_timeout') {
        await appendDiagEvent({
          scope,
          runId,
          stage: 'timeout',
          source: 'sendMessageToTabWithRetry',
          reason: lastReason,
          payload: { action: message?.action || '', attempt, maxAttempts, scope },
        });
      }
      if (!classified.retryable || attempt >= maxAttempts) {
        const finalErr = new Error(lastMessage || lastReason);
        finalErr.code = lastReason;
        finalErr.retryable = classified.retryable;
        throw finalErr;
      }
      await sleep(retryDelayMs * attempt);
    }
  }
  const exhaustedErr = new Error(lastMessage || lastReason);
  exhaustedErr.code = lastReason;
  exhaustedErr.retryable = false;
  throw exhaustedErr;
}

async function ensureContentReady(tabId, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 8));
  const pingTimeoutMs = Math.max(1000, Number(options.pingTimeoutMs || 5000));
  const retryDelayMs = Math.max(200, Number(options.retryDelayMs || 700));
  try {
    const response = await sendMessageToTabWithRetry(
      tabId,
      { action: 'ping' },
      {
        timeoutMs: pingTimeoutMs,
        maxAttempts,
        retryDelayMs,
        scope: options.scope || 'system',
        runId: options.runId || '',
      }
    );
    if (response?.ok) return { ok: true, reason: '', attempts: 1 };
    return { ok: false, reason: 'content_ping_invalid_response', attempts: maxAttempts };
  } catch (err) {
    const reason = getTabMessageErrorReason(err, 'content_script_not_ready');
    return { ok: false, reason: reason || 'content_script_not_ready', attempts: maxAttempts };
  }
}

let inmailWorkerRunning = false;
let followRetryWorkerRunning = false;

async function runFollowRetryBatch() {
  if (followRetryWorkerRunning) return;
  followRetryWorkerRunning = true;
  try {
    while (true) {
      const data = await getStorage([STORAGE_KEYS.followRetryBatch, STORAGE_KEYS.debugMode, STORAGE_KEYS.customMessage]);
      const batch = data[STORAGE_KEYS.followRetryBatch];
      const runId = String(batch?.runId || '');
      if (!batch || batch.status !== 'running') break;
      if (batch.stopRequested) {
        batch.status = 'stopped';
        batch.finishedAt = Date.now();
        await setStorage({ [STORAGE_KEYS.followRetryBatch]: batch });
        await appendDiagEvent({
          scope: 'follow_retry',
          runId,
          stage: 'stop',
          source: 'runFollowRetryBatch',
          reason: String(batch.stopReason || 'stopped_by_user'),
        });
        await setActiveRunId('follow_retry', '');
        await persistFollowRetryResults(batch);
        break;
      }
      if (batch.cursor >= batch.rows.length) {
        batch.status = 'finished';
        batch.finishedAt = Date.now();
        await setStorage({ [STORAGE_KEYS.followRetryBatch]: batch });
        await appendDiagEvent({
          scope: 'follow_retry',
          runId,
          stage: 'finish',
          source: 'runFollowRetryBatch',
          reason: String(batch.stopReason || 'finished'),
        });
        await setActiveRunId('follow_retry', '');
        await persistFollowRetryResults(batch);
        break;
      }

      const row = batch.rows[batch.cursor];
      const tabId = batch.tabId;
      if (!Number.isInteger(tabId)) {
        row.status = 'FAILED';
        row.reason = 'tab_not_available';
      } else {
        let success = false;
        let lastReason = 'follow_retry_error';
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await updateTabUrl(tabId, row.profile_url);
            const tabCompleted = await waitTabComplete(tabId, 20000);
            if (!tabCompleted) throw new Error('tab_complete_timeout');
            const linkedInReady = await waitForTabLinkedInReady(tabId, row.profile_url, 90000);
            if (!linkedInReady) throw new Error('tab_not_ready_timeout');
            await sleep(1200 + (attempt - 1) * 900);
            const contentReady = await ensureContentReady(tabId, {
              maxAttempts: 10,
              pingTimeoutMs: 5000,
              retryDelayMs: 700,
              scope: 'follow_retry',
              runId,
            });
            if (!contentReady.ok) {
              throw new Error(contentReady.reason || 'content_script_not_ready');
            }
            const response = await sendMessageToTabWithRetry(
              tabId,
              {
                action: 'processConnectProfile',
                profileUrl: row.profile_url,
                fullName: row.full_name || '',
                customMessage: data[STORAGE_KEYS.customMessage] || '',
                debugMode: !!data[STORAGE_KEYS.debugMode],
                runId,
              },
              { timeoutMs: 45000, maxAttempts: 3, retryDelayMs: 1200, scope: 'follow_retry', runId }
            );
            if (response?.status === 'RETRY') {
              throw new Error(String(response?.reason || 'profile_not_ready_retry'));
            }
            const normalized = normalizeBatchRowOutcome(response, 'follow_retry_error');
            row.status = normalized.status;
            row.reason = normalized.reason;
            success = true;
            break;
          } catch (err) {
            lastReason = getTabMessageErrorReason(err, 'follow_retry_error');
            if (attempt < 3 && (isTransientTabMessageError(err) || isRetryableBatchReason(lastReason))) {
              await appendDiagEvent({
                scope: 'follow_retry',
                runId,
                stage: 'retry',
                source: 'runFollowRetryBatch',
                reason: lastReason,
                payload: { action: 'processConnectProfile', attempt, maxAttempts: 3, cursor: batch.cursor + 1, total: batch.rows.length },
              });
              await sleep(1800 * attempt);
              continue;
            }
            break;
          }
        }
        if (!success) {
          row.status = 'FAILED';
          row.reason = lastReason || 'follow_retry_error';
        }
      }

      row.updated_at = new Date().toISOString();
      if (row.status === 'SENT') {
        await addAnalyticsEvent('invite_sent', { profile_url: row.profile_url, source: 'follow_retry' });
        await enqueueApiEvent('invite_sent', { profile_url_canonical: row.profile_url, source: 'follow_retry' });
      } else if (row.status === 'SKIPPED') {
        await addAnalyticsEvent('connect_available', {
          profile_url: row.profile_url,
          available: false,
          reason: row.reason || 'connect_not_available',
        });
      } else {
        await addAnalyticsEvent('invite_failed', {
          profile_url: row.profile_url,
          reason: row.reason || 'invite_failed',
          source: 'follow_retry',
        });
        await enqueueApiEvent('invite_failed', {
          profile_url_canonical: row.profile_url,
          reason: row.reason || 'invite_failed',
          source: 'follow_retry',
        });
      }
      if (row.status === 'SENT') batch.sent++;
      else if (row.status === 'FAILED') batch.failed++;
      else batch.skipped++;

      const followBatchStopReason = normalizeLinkedinLimitReason(row.reason);
      if (followBatchStopReason) {
        batch.rows[batch.cursor] = row;
        batch.cursor++;
        batch.stopRequested = true;
        batch.status = 'stopped';
        batch.stopReason = followBatchStopReason;
        batch.finishedAt = Date.now();
        await setStorage({ [STORAGE_KEYS.followRetryBatch]: batch });
        await appendDiagEvent({
          scope: 'follow_retry',
          runId,
          stage: 'finish',
          source: 'runFollowRetryBatch',
          reason: followBatchStopReason,
          payload: { cursor: batch.cursor, total: batch.rows.length },
        });
        await setActiveRunId('follow_retry', '');
        await persistFollowRetryResults(batch);
        break;
      }

      batch.rows[batch.cursor] = row;
      batch.cursor++;
      await setStorage({ [STORAGE_KEYS.followRetryBatch]: batch });
      await flushApiQueue(12);
      await sleep(1200);
    }
  } finally {
    followRetryWorkerRunning = false;
  }
}

async function runInmailBatch() {
  if (inmailWorkerRunning) return;
  inmailWorkerRunning = true;
  try {
    while (true) {
      const data = await getStorage([STORAGE_KEYS.inmailBatch, STORAGE_KEYS.inmailDraft, STORAGE_KEYS.debugMode]);
      const batch = data[STORAGE_KEYS.inmailBatch];
      const runId = String(batch?.runId || '');
      const debugEnabled = !!data[STORAGE_KEYS.debugMode];
      const debugBatchLog = (...args) => {
        if (debugEnabled) console.log('[Connect-In][InMailBatch]', ...args);
      };
      if (!batch || batch.status !== 'running') break;
      if (batch.stopRequested) {
        batch.status = 'stopped';
        batch.finishedAt = Date.now();
        await setStorage({ [STORAGE_KEYS.inmailBatch]: batch });
        await appendDiagEvent({
          scope: 'inmail_batch',
          runId,
          stage: 'stop',
          source: 'runInmailBatch',
          reason: String(batch.stopReason || 'stopped_by_user'),
        });
        await setActiveRunId('inmail_batch', '');
        break;
      }
      if (batch.cursor >= batch.rows.length) {
        batch.status = 'finished';
        batch.finishedAt = Date.now();
        await setStorage({ [STORAGE_KEYS.inmailBatch]: batch });
        await appendDiagEvent({
          scope: 'inmail_batch',
          runId,
          stage: 'finish',
          source: 'runInmailBatch',
          reason: String(batch.stopReason || 'finished'),
        });
        await setActiveRunId('inmail_batch', '');
        break;
      }
      const row = batch.rows[batch.cursor];
      const tabId = batch.tabId;
      debugBatchLog('Procesando fila', {
        cursor: batch.cursor + 1,
        total: batch.rows.length,
        profile_url: row?.profile_url || '',
      });
      if (!Number.isInteger(tabId)) {
        row.status = 'FAILED';
        row.reason = 'tab_not_available';
        debugBatchLog('Fallo: tab no disponible');
      } else {
        let lastErrText = '';
        let success = false;
        const targetCanonical = canonicalizeLinkedinUrl(row.profile_url);
        for (let attempt = 1; attempt <= 3; attempt++) {
          debugBatchLog('Intento', attempt, 'para', row.profile_url);
          try {
            const tabBefore = await getTab(tabId);
            const currentCanonical = canonicalizeLinkedinUrl(tabBefore?.url || '');
            const shouldNavigate = !targetCanonical || currentCanonical !== targetCanonical;
            if (shouldNavigate) {
              await updateTabUrl(tabId, row.profile_url);
              const tabCompleted = await waitTabComplete(tabId, 45000);
              if (!tabCompleted) {
                throw new Error('tab_complete_timeout');
              }
            } else {
              debugBatchLog('Reutilizando perfil ya cargado, sin recargar URL');
            }
            const linkedInReady = await waitForTabLinkedInReady(tabId, row.profile_url, 90000);
            if (!linkedInReady) {
              throw new Error('tab_not_ready_timeout');
            }
            await sleep(2000 + (attempt - 1) * 1200);
            const contentReady = await ensureContentReady(tabId, {
              maxAttempts: 30,
              pingTimeoutMs: 5000,
              retryDelayMs: 700,
              scope: 'inmail_batch',
              runId,
            });
            if (!contentReady.ok) {
              throw new Error(contentReady.reason || 'content_script_not_ready');
            }
            const response = await sendMessageToTabWithRetry(
              tabId,
              {
                action: 'processInmailProfile',
                profileUrl: row.profile_url,
                fullName: row.full_name || '',
                subject: data[STORAGE_KEYS.inmailDraft]?.subject || '',
                message: data[STORAGE_KEYS.inmailDraft]?.message || '',
                debugMode: !!data[STORAGE_KEYS.debugMode],
                runId,
              },
              { timeoutMs: 70000, maxAttempts: 2, retryDelayMs: 1500, scope: 'inmail_batch', runId }
            );
            if (response?.status === 'RETRY') {
              debugBatchLog('Content pidió retry', response?.reason || 'profile_not_ready_retry');
              throw new Error(response?.reason || 'profile_not_ready_retry');
            }
            if (
              (response?.status === 'FAILED' && ['message_field_not_found', 'composer_not_found', 'composer_send_not_found'].includes(String(response?.reason || ''))) ||
              (response?.status === 'SKIPPED' && ['message_button_not_found'].includes(String(response?.reason || '')))
            ) {
              debugBatchLog('Content devolvió estado reintentable', {
                status: response?.status || '',
                reason: response?.reason || '',
              });
              throw new Error(String(response?.reason || 'inmail_retryable_state'));
            }
            const normalized = normalizeBatchRowOutcome(response, 'inmail_unexpected_error');
            row.status = normalized.status;
            row.reason = normalized.reason;
            debugBatchLog('Respuesta content', { status: row.status, reason: row.reason || '' });
            success = true;
            break;
          } catch (err) {
            lastErrText = getTabMessageErrorReason(err, 'content_message_error');
            debugBatchLog('Error intento', attempt, lastErrText);
            if (
              attempt < 3 &&
              (isTransientTabMessageError(err) || isRetryableBatchReason(lastErrText))
            ) {
              await appendDiagEvent({
                scope: 'inmail_batch',
                runId,
                stage: 'retry',
                source: 'runInmailBatch',
                reason: lastErrText,
                payload: { action: 'processInmailProfile', attempt, maxAttempts: 3, cursor: batch.cursor + 1, total: batch.rows.length },
              });
              await sleep(2200);
              continue;
            }
            break;
          }
        }
        if (!success) {
          row.status = 'FAILED';
          row.reason = lastErrText || 'content_message_error';
          debugBatchLog('Fallo final fila', { status: row.status, reason: row.reason });
        }
      }
      row.updated_at = new Date().toISOString();
      if (row.status === 'SENT') batch.sent++;
      else if (row.status === 'FAILED') batch.failed++;
      else batch.skipped++;

      // Si no conseguimos localizar el campo de mensaje o el composer,
      // detenemos el lote para que el usuario pueda revisar la UI en lugar
      // de seguir saltando perfiles que probablemente fallen igual.
      if (row.status === 'FAILED' && (row.reason === 'message_field_not_found' || row.reason === 'composer_not_found')) {
        batch.cursor++;
        batch.rows[batch.cursor - 1] = row;
        batch.stopRequested = true;
        batch.status = 'stopped';
        batch.stopReason = row.reason;
        batch.finishedAt = Date.now();
        await setStorage({ [STORAGE_KEYS.inmailBatch]: batch });
        await appendDiagEvent({
          scope: 'inmail_batch',
          runId,
          stage: 'finish',
          source: 'runInmailBatch',
          reason: row.reason,
          payload: { cursor: batch.cursor, total: batch.rows.length },
        });
        await setActiveRunId('inmail_batch', '');
        break;
      }
      const inmailBatchStopReason = normalizeLinkedinLimitReason(row.reason);
      if (inmailBatchStopReason) {
        batch.cursor++;
        batch.rows[batch.cursor - 1] = row;
        batch.stopRequested = true;
        batch.status = 'stopped';
        batch.stopReason = inmailBatchStopReason;
        batch.finishedAt = Date.now();
        await setStorage({ [STORAGE_KEYS.inmailBatch]: batch });
        await appendDiagEvent({
          scope: 'inmail_batch',
          runId,
          stage: 'finish',
          source: 'runInmailBatch',
          reason: inmailBatchStopReason,
          payload: { cursor: batch.cursor, total: batch.rows.length },
        });
        await setActiveRunId('inmail_batch', '');
        break;
      }
      batch.cursor++;
      batch.rows[batch.cursor - 1] = row;
      debugBatchLog('Fila finalizada', {
        profile_url: row.profile_url,
        status: row.status,
        reason: row.reason || '',
      });
      await setStorage({ [STORAGE_KEYS.inmailBatch]: batch });
      await sleep(1300);
    }
  } finally {
    inmailWorkerRunning = false;
  }
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!details || details.tabId < 0) return;
    if (details.statusCode !== 429) return;
    if (!isLinkedInInviteQuotaUrl(details.url)) return;
    quotaByTabId.set(details.tabId, true);
    chrome.tabs.sendMessage(details.tabId, { action: 'linkedinQuota429' }, () => {
      if (chrome.runtime.lastError) {
        // Puede pasar si el tab no tiene content script inyectado en ese momento.
      }
    });
  },
  { urls: ['https://www.linkedin.com/*'], types: ['xmlhttprequest'] }
);

chrome.tabs.onRemoved.addListener(async (tabId) => {
  quotaByTabId.delete(tabId);
  const data = await getStorage([STORAGE_KEYS.inmailBatch, STORAGE_KEYS.followRetryBatch]);
  const batch = data[STORAGE_KEYS.inmailBatch];
  if (batch?.status === 'running' && batch.tabId === tabId) {
    batch.status = 'stopped';
    batch.stopRequested = true;
    batch.stopReason = 'tab_closed';
    batch.finishedAt = Date.now();
    await setStorage({ [STORAGE_KEYS.inmailBatch]: batch });
    await appendDiagEvent({
      scope: 'inmail_batch',
      runId: String(batch.runId || ''),
      stage: 'stop',
      source: 'tab_closed',
      reason: 'tab_closed',
    });
    await setActiveRunId('inmail_batch', '');
  }
  const followBatch = data[STORAGE_KEYS.followRetryBatch];
  if (followBatch?.status === 'running' && followBatch.tabId === tabId) {
    followBatch.status = 'stopped';
    followBatch.stopRequested = true;
    followBatch.stopReason = 'tab_closed';
    followBatch.finishedAt = Date.now();
    await setStorage({ [STORAGE_KEYS.followRetryBatch]: followBatch });
    await appendDiagEvent({
      scope: 'follow_retry',
      runId: String(followBatch.runId || ''),
      stage: 'stop',
      source: 'tab_closed',
      reason: 'tab_closed',
    });
    await setActiveRunId('follow_retry', '');
  }
});

ensureStorageMigration();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.action === 'start') {
      const tab = await queryActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No hay pestaña activa' });
        return;
      }
      if (!isLinkedInTab(tab)) {
        sendResponse({ ok: false, error: 'Abre una pestaña de LinkedIn (www.linkedin.com)' });
        return;
      }
      resetQuotaFlagForTab(tab.id);
      const runId = createRunId('connect');
      try {
        const data = await getStorage([STORAGE_KEYS.debugMode]);
        const response = await sendMessageToTabWithRetry(
          tab.id,
          { ...message, debugMode: !!data[STORAGE_KEYS.debugMode], runId },
          { timeoutMs: 9000, maxAttempts: 2, retryDelayMs: 900, scope: 'connect_loop', runId }
        );
        if (response?.ok === false) {
          sendResponse(response);
          return;
        }
        await transitionLastRunStatus(RUN_STATES.running, { finishReason: '' });
        await setActiveRunId('connect_loop', runId);
        await appendDiagEvent({
          scope: 'connect_loop',
          runId,
          stage: 'start',
          source: 'popup_start',
          reason: 'started',
        });
        sendResponse({ ...(response ?? { ok: true }), runId });
      } catch (err) {
        const reason = getTabMessageErrorReason(err, '');
        await appendDiagEvent({
          scope: 'connect_loop',
          runId,
          stage: reason === 'tab_message_timeout' ? 'timeout' : 'finish',
          source: 'popup_start',
          reason: reason || 'start_failed',
        });
        if (reason === 'content_script_not_ready') {
          sendResponse({ ok: false, error: 'Recarga la página de LinkedIn (F5), espera a que cargue por completo y vuelve a pulsar Iniciar.' });
          return;
        }
        const msg = String(err?.message || '');
        sendResponse({ ok: false, error: msg || 'Error de comunicación con la pestaña.' });
      }
      return;
    }

    if (message.action === 'stop') {
      await transitionLastRunStatus(RUN_STATES.stopped, { finishReason: 'stopped_by_user' });
      const dataObs = await getStorage([STORAGE_KEYS.observability]);
      const obs = normalizeObservability(dataObs[STORAGE_KEYS.observability]);
      await appendDiagEvent({
        scope: 'connect_loop',
        runId: obs.active.connectRunId || '',
        stage: 'stop',
        source: 'popup_stop',
        reason: 'stopped_by_user',
      });
      const tab = await queryActiveTab();
      if (!tab?.id || !isLinkedInTab(tab)) {
        await setActiveRunId('connect_loop', '');
        sendResponse({ ok: true });
        return;
      }
      try {
        const data = await getStorage([STORAGE_KEYS.debugMode]);
        await sendMessageToTab(tab.id, { ...message, debugMode: !!data[STORAGE_KEYS.debugMode] }, 9000);
      } catch (_) {
        // El estado ya quedó en stopped; ignoramos fallos de entrega del stop.
      }
      await setActiveRunId('connect_loop', '');
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'setDebugMode') {
      await setStorage({ [STORAGE_KEYS.debugMode]: !!message.enabled });
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'getLinkedinQuotaState') {
      const tabId = sender?.tab?.id;
      if (typeof tabId === 'number') {
        sendResponse({ reached: quotaByTabId.get(tabId) === true });
        return;
      }
      const tab = await queryActiveTab();
      sendResponse({ reached: !!tab?.id && quotaByTabId.get(tab.id) === true });
      return;
    }

    if (message.action === 'sent') {
      const data = await getStorage([
        STORAGE_KEYS.connectionCount,
        STORAGE_KEYS.rateLimits,
        STORAGE_KEYS.inviteRateState,
      ]);
      const count = (data[STORAGE_KEYS.connectionCount] ?? 0) + 1;
      const rateLimits = normalizeRateLimits(data[STORAGE_KEYS.rateLimits]);
      const rateState = normalizeInviteRateState(data[STORAGE_KEYS.inviteRateState]);
      const nextRateState = {
        ...rateState,
        hourCount: rateState.hourCount + 1,
        dayCount: rateState.dayCount + 1,
      };
      await setStorage({
        [STORAGE_KEYS.connectionCount]: count,
        [STORAGE_KEYS.inviteRateState]: nextRateState,
      });
      await addAnalyticsEvent('invite_sent', { source: 'connect_loop' });
      await enqueueApiEvent('invite_sent', { source: 'connect_loop' });
      await flushApiQueue(8);
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'inviteFailed') {
      const profileUrl = canonicalizeLinkedinUrl(message.profile_url || message.url || '');
      await addAnalyticsEvent('invite_failed', {
        profile_url: profileUrl || '',
        reason: String(message.reason || 'invite_failed'),
        source: 'connect_loop',
      });
      await enqueueApiEvent('invite_failed', {
        profile_url_canonical: profileUrl || '',
        reason: String(message.reason || 'invite_failed'),
        source: 'connect_loop',
      });
      await flushApiQueue(8);
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'canSendInvite') {
      const data = await getStorage([STORAGE_KEYS.rateLimits, STORAGE_KEYS.inviteRateState]);
      const persistedLimits = normalizeRateLimits(data[STORAGE_KEYS.rateLimits]);
      const runtimeLimits = normalizeRateLimits({ hour: message.hourLimit, day: message.dayLimit });
      const effectiveLimits = {
        hour: runtimeLimits.hour > 0 ? runtimeLimits.hour : persistedLimits.hour,
        day: runtimeLimits.day > 0 ? runtimeLimits.day : persistedLimits.day,
      };
      const rateState = normalizeInviteRateState(data[STORAGE_KEYS.inviteRateState]);
      const check = checkRateLimit(rateState, effectiveLimits);
      await setStorage({ [STORAGE_KEYS.inviteRateState]: rateState });
      sendResponse({
        ok: true,
        allowed: check.allowed,
        reason: check.reason,
        rateState,
        limits: effectiveLimits,
      });
      return;
    }

    if (message.action === 'getCount') {
      const data = await getStorage([STORAGE_KEYS.connectionCount]);
      sendResponse({ count: data[STORAGE_KEYS.connectionCount] ?? 0 });
      return;
    }

    if (message.action === 'getConfig') {
      await ensureStorageMigration();
      const data = await getStorage([
        STORAGE_KEYS.connectionCount,
        STORAGE_KEYS.customMessage,
        STORAGE_KEYS.followList,
        STORAGE_KEYS.lastRunStatus,
        STORAGE_KEYS.debugMode,
        STORAGE_KEYS.rateLimits,
        STORAGE_KEYS.followExportMeta,
        STORAGE_KEYS.followRetryBatch,
        STORAGE_KEYS.followRetrySettings,
        STORAGE_KEYS.inmailDraft,
        STORAGE_KEYS.inmailBatch,
        STORAGE_KEYS.apiConfig,
        STORAGE_KEYS.apiEventQueue,
        STORAGE_KEYS.analytics,
        STORAGE_KEYS.stopStats,
        STORAGE_KEYS.observability,
      ]);
      const observability = normalizeObservability(data[STORAGE_KEYS.observability]);
      sendResponse({
        connectionCount: data[STORAGE_KEYS.connectionCount] ?? 0,
        customMessage: data[STORAGE_KEYS.customMessage] ?? '',
        followList: data[STORAGE_KEYS.followList] ?? [],
        lastRunStatus: data[STORAGE_KEYS.lastRunStatus] ?? null,
        debugMode: !!data[STORAGE_KEYS.debugMode],
        rateLimits: normalizeRateLimits(data[STORAGE_KEYS.rateLimits]),
        followExportMeta: data[STORAGE_KEYS.followExportMeta] ?? { lastExportAt: null },
        followRetryBatch: data[STORAGE_KEYS.followRetryBatch] ?? null,
        followRetrySettings: data[STORAGE_KEYS.followRetrySettings] ?? { scoreKeywords: '', whitelist: '', blacklist: '' },
        inmailDraft: data[STORAGE_KEYS.inmailDraft] ?? { subject: '', message: '' },
        inmailBatch: data[STORAGE_KEYS.inmailBatch] ?? null,
        apiConfig: API_SYNC_ENABLED ? normalizeApiConfig(data[STORAGE_KEYS.apiConfig]) : { enabled: false, baseUrl: '', apiKey: '' },
        apiQueueSize: API_SYNC_ENABLED ? (data[STORAGE_KEYS.apiEventQueue]?.items?.length || 0) : 0,
        analytics: data[STORAGE_KEYS.analytics] ?? null,
        stopStats: data[STORAGE_KEYS.stopStats] ?? { total: 0, byReason: {} },
        qaEventsCount: observability.events.length,
        activeRuns: observability.active,
      });
      return;
    }

    if (message.action === 'saveRateLimits') {
      const limits = normalizeRateLimits({ hour: message.hour, day: message.day });
      await setStorage({ [STORAGE_KEYS.rateLimits]: limits });
      sendResponse({ ok: true, limits });
      return;
    }

    if (message.action === 'finished') {
      const obsData = await getStorage([STORAGE_KEYS.observability]);
      const obs = normalizeObservability(obsData[STORAGE_KEYS.observability]);
      const resolvedRunId = String(message.runId || obs.active.connectRunId || '');
      const finishReason = normalizeFinishReason(message.finishReason || message.reason);
      const nextState = finishReason === 'stopped_by_user' ? RUN_STATES.stopped : RUN_STATES.finished;
      const transition = await transitionLastRunStatus(nextState, {
        finishReason,
        sentThisSession: message.sentThisSession ?? 0,
        limit: message.limit ?? 0,
        detail: message.detail || '',
      });
      if (!transition.ok) {
        sendResponse({ ok: true, ignored: true });
        return;
      }
      await addStopStat(finishReason, message.detail || '');
      await addAnalyticsEvent('run_finished', {
        reason: finishReason,
        detail: message.detail || '',
        sentThisSession: Number(message.sentThisSession || 0),
      });
      await enqueueApiEvent('run_finished', {
        reason: finishReason,
        detail: message.detail || '',
        sentThisSession: Number(message.sentThisSession || 0),
      });
      await appendDiagEvent({
        scope: 'connect_loop',
        runId: resolvedRunId,
        stage: 'finish',
        source: 'content_finished',
        reason: finishReason,
        detail: String(message.detail || ''),
        payload: { status: nextState, reason: finishReason },
      });
      await setActiveRunId('connect_loop', '');
      await flushApiQueue(8);
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'addToFollowList') {
      await ensureStorageMigration();
      const data = await getStorage([STORAGE_KEYS.followList]);
      const list = data[STORAGE_KEYS.followList] ?? [];
      const normalized = normalizeFollowEntry({
        profile_url: message.profile_url || message.url || '',
        full_name: message.full_name || message.name || '',
        headline: message.headline || '',
        location: message.location || '',
        query: message.query || '',
        page: message.page || 0,
        status: message.status || 'follow_detected',
      });
      if (!normalized) {
        sendResponse({ ok: false, error: 'Perfil inválido.' });
        return;
      }
      if (!list.some((entry) => entry.profile_url === normalized.profile_url)) {
        list.push(normalized);
        await setStorage({ [STORAGE_KEYS.followList]: list });
        await addAnalyticsEvent('lead_detected', {
          profile_url: normalized.profile_url,
          query: normalized.query || '',
          page: normalized.page || 0,
        });
        await enqueueApiEvent('lead_detected', {
          profile_url_canonical: normalized.profile_url,
          query: normalized.query || '',
          page: normalized.page || 0,
        });
        await flushApiQueue(6);
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'saveApiConfig') {
      if (!API_SYNC_ENABLED) { sendResponse({ ok: false, error: 'API sync disabled' }); return; }
      const nextConfig = normalizeApiConfig({
        enabled: message.enabled,
        baseUrl: message.baseUrl,
        apiKey: message.apiKey,
      });
      await setStorage({ [STORAGE_KEYS.apiConfig]: nextConfig });
      await flushApiQueue(20);
      sendResponse({ ok: true, config: nextConfig });
      return;
    }

    if (message.action === 'getApiSyncState') {
      if (!API_SYNC_ENABLED) { sendResponse({ ok: true, apiConfig: { enabled: false, baseUrl: '', apiKey: '' }, queueSize: 0, stopStats: {}, analytics: null }); return; }
      const data = await getStorage([STORAGE_KEYS.apiConfig, STORAGE_KEYS.apiEventQueue, STORAGE_KEYS.stopStats, STORAGE_KEYS.analytics]);
      const cfg = normalizeApiConfig(data[STORAGE_KEYS.apiConfig]);
      const queue = data[STORAGE_KEYS.apiEventQueue] || { version: API_QUEUE_VERSION, items: [] };
      const analytics = data[STORAGE_KEYS.analytics] || null;
      sendResponse({
        ok: true,
        apiConfig: cfg,
        queueSize: Array.isArray(queue.items) ? queue.items.length : 0,
        stopStats: data[STORAGE_KEYS.stopStats] || { total: 0, byReason: {} },
        analytics,
      });
      return;
    }

    if (message.action === 'syncApiNow') {
      if (!API_SYNC_ENABLED) { sendResponse({ ok: true, queueSize: 0 }); return; }
      await flushApiQueue(40);
      const data = await getStorage([STORAGE_KEYS.apiEventQueue]);
      sendResponse({ ok: true, queueSize: data[STORAGE_KEYS.apiEventQueue]?.items?.length || 0 });
      return;
    }

    if (message.action === 'saveFollowRetrySettings') {
      const settings = {
        scoreKeywords: String(message.scoreKeywords || '').trim(),
        whitelist: String(message.whitelist || '').trim(),
        blacklist: String(message.blacklist || '').trim(),
      };
      await setStorage({ [STORAGE_KEYS.followRetrySettings]: settings });
      sendResponse({ ok: true, settings });
      return;
    }

    if (message.action === 'startFollowRetryBatch') {
      await ensureStorageMigration();
      const tab = await queryActiveTab();
      if (!tab?.id || !isLinkedInTab(tab)) {
        sendResponse({ ok: false, error: 'Abre una pestaña de LinkedIn para iniciar Procesar CSV.' });
        return;
      }
      resetQuotaFlagForTab(tab.id);
      const data = await getStorage([STORAGE_KEYS.followList, STORAGE_KEYS.followRetrySettings]);
      const list = dedupeFollowEntries(data[STORAGE_KEYS.followList] || []);
      const settings = data[STORAGE_KEYS.followRetrySettings] || { scoreKeywords: '', whitelist: '', blacklist: '' };
      const candidates = list
        .filter((row) => row.profile_url && row.status !== 'invite_sent')
        .filter((row) => !matchListRule(row.profile_url, settings.blacklist))
        .filter((row) => {
          if (!String(settings.whitelist || '').trim()) return true;
          return matchListRule(row.profile_url, settings.whitelist);
        })
        .map((row) => ({ ...row, score: calculateSimpleScore(row, settings), updated_at: null, reason: '', status: 'PENDING' }))
        .sort((a, b) => b.score - a.score);

      if (!candidates.length) {
        sendResponse({ ok: false, error: 'No hay perfiles disponibles para procesar.' });
        return;
      }
      const maxRows = Number.parseInt(message.maxRows || 0, 10);
      const rows = maxRows > 0 ? candidates.slice(0, maxRows) : candidates;
      const runId = createRunId('follow');
      const batch = {
        version: FOLLOW_RETRY_BATCH_VERSION,
        status: 'running',
        rows,
        cursor: 0,
        total: rows.length,
        sent: 0,
        failed: 0,
        skipped: 0,
        startedAt: Date.now(),
        finishedAt: null,
        stopRequested: false,
        tabId: tab.id,
        runId,
      };
      await setStorage({ [STORAGE_KEYS.followRetryBatch]: batch });
      await setActiveRunId('follow_retry', runId);
      await appendDiagEvent({
        scope: 'follow_retry',
        runId,
        stage: 'start',
        source: 'popup_start_follow_retry',
        reason: 'started',
        payload: { total: rows.length },
      });
      runFollowRetryBatch();
      sendResponse({ ok: true, total: rows.length, runId });
      return;
    }

    if (message.action === 'stopFollowRetryBatch') {
      const data = await getStorage([STORAGE_KEYS.followRetryBatch]);
      const batch = data[STORAGE_KEYS.followRetryBatch];
      if (!batch || batch.status !== 'running') {
        sendResponse({ ok: true });
        return;
      }
      batch.stopRequested = true;
      batch.stopReason = 'stopped_by_user';
      await setStorage({ [STORAGE_KEYS.followRetryBatch]: batch });
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'getFollowRetryStatus' || message.action === 'getFollowRetryBatchStatus') {
      const data = await getStorage([STORAGE_KEYS.followRetryBatch, STORAGE_KEYS.followRetrySettings]);
      sendResponse({
        batch: data[STORAGE_KEYS.followRetryBatch] || null,
        settings: data[STORAGE_KEYS.followRetrySettings] || { scoreKeywords: '', whitelist: '', blacklist: '' },
      });
      return;
    }

    if (message.action === 'getFollowList') {
      await ensureStorageMigration();
      const data = await getStorage([STORAGE_KEYS.followList, STORAGE_KEYS.followExportMeta]);
      const list = data[STORAGE_KEYS.followList] ?? [];
      const mode = message.mode === 'incremental' ? 'incremental' : 'full';
      const exportList = mode === 'incremental' ? list.filter((row) => !row.exported_at) : list;
      if (message.markExported && exportList.length > 0) {
        const nowIso = new Date().toISOString();
        const exportedSet = new Set(exportList.map((row) => row.profile_url));
        const updated = list.map((row) => (exportedSet.has(row.profile_url) ? { ...row, exported_at: nowIso } : row));
        await setStorage({
          [STORAGE_KEYS.followList]: updated,
          [STORAGE_KEYS.followExportMeta]: { lastExportAt: nowIso },
        });
      }
      sendResponse({ list: exportList, mode });
      return;
    }

    if (message.action === 'clearFollowList') {
      await setStorage({
        [STORAGE_KEYS.followList]: [],
        [STORAGE_KEYS.followExportMeta]: { lastExportAt: null },
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'saveInmailDraft') {
      await setStorage({
        [STORAGE_KEYS.inmailDraft]: {
          subject: String(message.subject || '').trim(),
          message: String(message.message || '').trim(),
        },
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'startInmailBatch') {
      const tab = await queryActiveTab();
      if (!tab?.id || !isLinkedInTab(tab)) {
        sendResponse({ ok: false, error: 'Abre una pestaña de LinkedIn para iniciar el lote InMail.' });
        return;
      }
      resetQuotaFlagForTab(tab.id);
      const subject = String(message.subject || '').trim();
      const body = String(message.message || '').trim();
      if (!subject || !body) {
        sendResponse({ ok: false, error: 'Completa asunto y mensaje antes de iniciar.' });
        return;
      }
      const parsed = parseInmailCsv(message.csvText || '');
      if (parsed.error) {
        sendResponse({ ok: false, error: parsed.error });
        return;
      }
      const runId = createRunId('inmail');
      const batch = {
        version: INMAIL_BATCH_VERSION,
        status: 'running',
        rows: parsed.rows,
        cursor: 0,
        total: parsed.rows.length,
        sent: 0,
        failed: 0,
        skipped: 0,
        duplicatesRemoved: parsed.duplicatesRemoved,
        startedAt: Date.now(),
        finishedAt: null,
        stopRequested: false,
        tabId: tab.id,
        runId,
      };
      await setStorage({
        [STORAGE_KEYS.inmailDraft]: { subject, message: body },
        [STORAGE_KEYS.inmailBatch]: batch,
      });
      await setActiveRunId('inmail_batch', runId);
      await appendDiagEvent({
        scope: 'inmail_batch',
        runId,
        stage: 'start',
        source: 'popup_start_inmail_batch',
        reason: 'started',
        payload: { total: batch.total },
      });
      runInmailBatch();
      sendResponse({ ok: true, total: batch.total, duplicatesRemoved: batch.duplicatesRemoved, runId });
      return;
    }

    if (message.action === 'stopInmailBatch') {
      const data = await getStorage([STORAGE_KEYS.inmailBatch]);
      const batch = data[STORAGE_KEYS.inmailBatch];
      if (!batch || batch.status !== 'running') {
        sendResponse({ ok: true });
        return;
      }
      batch.stopRequested = true;
      batch.stopReason = 'stopped_by_user';
      await setStorage({ [STORAGE_KEYS.inmailBatch]: batch });
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'getInmailBatchStatus') {
      const data = await getStorage([STORAGE_KEYS.inmailBatch]);
      sendResponse({ batch: data[STORAGE_KEYS.inmailBatch] || null });
      return;
    }

    if (message.action === 'exportInmailResults') {
      const data = await getStorage([STORAGE_KEYS.inmailBatch]);
      const batch = data[STORAGE_KEYS.inmailBatch];
      sendResponse({ rows: batch?.rows || [], meta: batch || null });
      return;
    }

    if (message.action === 'diagEvent') {
      await appendDiagEvent({
        scope: String(message.scope || 'connect_loop'),
        runId: String(message.runId || ''),
        stage: String(message.stage || 'info'),
        source: String(message.source || 'content'),
        reason: String(message.reason || ''),
        detail: String(message.detail || ''),
        payload: pickDiagPayload(message.payload || {}),
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'exportQaEvidence') {
      await ensureStorageMigration();
      const data = await getStorage([
        STORAGE_KEYS.observability,
        STORAGE_KEYS.lastRunStatus,
        STORAGE_KEYS.followRetryBatch,
        STORAGE_KEYS.inmailBatch,
        STORAGE_KEYS.analytics,
        STORAGE_KEYS.stopStats,
      ]);
      sendResponse({
        ok: true,
        exportedAt: new Date().toISOString(),
        observability: normalizeObservability(data[STORAGE_KEYS.observability]),
        lastRunStatus: data[STORAGE_KEYS.lastRunStatus] || null,
        followRetryBatch: data[STORAGE_KEYS.followRetryBatch] || null,
        inmailBatch: data[STORAGE_KEYS.inmailBatch] || null,
        stopStats: data[STORAGE_KEYS.stopStats] || { total: 0, byReason: {} },
        analyticsCounters: data[STORAGE_KEYS.analytics]?.counters || null,
      });
      return;
    }

    sendResponse({ ok: false, error: 'Acción no soportada.' });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err || 'Error interno') });
  });
  return true;
});
