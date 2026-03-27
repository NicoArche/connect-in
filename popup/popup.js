const STORAGE_KEYS = {
  connectionCount: 'connectionCount',
  customMessage: 'customMessage',
  followList: 'followList',
  lastRunStatus: 'lastRunStatus',
  rateLimits: 'rateLimits',
  messageTemplates: 'messageTemplates',
  shortcuts: 'shortcuts',
  sessionLimit: 'sessionLimit',
  delayRange: 'delayRange',
  inmailCsvDraft: 'inmailCsvDraft',
};

const el = {
  tabConnections: document.getElementById('tabConnections'),
  tabInmail: document.getElementById('tabInmail'),
  tabAnalysis: document.getElementById('tabAnalysis'),
  tabSettings: document.getElementById('tabSettings'),
  panelConnections: document.getElementById('panelConnections'),
  panelInmail: document.getElementById('panelInmail'),
  panelAnalysis: document.getElementById('panelAnalysis'),
  panelSettings: document.getElementById('panelSettings'),
  connectionCount: document.getElementById('connectionCount'),
  followCount: document.getElementById('followCount'),
  btnExportFull: document.getElementById('btnExportFull'),
  btnExportIncremental: document.getElementById('btnExportIncremental'),
  btnExportQaEvidence: document.getElementById('btnExportQaEvidence'),
  customMessage: document.getElementById('customMessage'),
  limit: document.getElementById('limit'),
  delayRange: document.getElementById('delayRange'),
  hourLimit: document.getElementById('hourLimit'),
  dayLimit: document.getElementById('dayLimit'),
  debugMode: document.getElementById('debugMode'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  followRetryProgress: document.getElementById('followRetryProgress'),
  followRetrySentCount: document.getElementById('followRetrySentCount'),
  followRetryFailedCount: document.getElementById('followRetryFailedCount'),
  followRetrySkippedCount: document.getElementById('followRetrySkippedCount'),
  btnStartFollowRetry: document.getElementById('btnStartFollowRetry'),
  btnStopFollowRetry: document.getElementById('btnStopFollowRetry'),
  scoreKeywords: document.getElementById('scoreKeywords'),
  followWhitelist: document.getElementById('followWhitelist'),
  followBlacklist: document.getElementById('followBlacklist'),
  followRetryMaxRows: document.getElementById('followRetryMaxRows'),
  templateSelect: document.getElementById('templateSelect'),
  templateName: document.getElementById('templateName'),
  templateText: document.getElementById('templateText'),
  btnSaveTemplate: document.getElementById('btnSaveTemplate'),
  btnApplyTemplate: document.getElementById('btnApplyTemplate'),
  templatePreview: document.getElementById('templatePreview'),
  shortcutStartStop: document.getElementById('shortcutStartStop'),
  shortcutFollowRetry: document.getElementById('shortcutFollowRetry'),
  shortcutToggleDebug: document.getElementById('shortcutToggleDebug'),
  apiEnabled: document.getElementById('apiEnabled'),
  apiBaseUrl: document.getElementById('apiBaseUrl'),
  apiKey: document.getElementById('apiKey'),
  btnSaveApiConfig: document.getElementById('btnSaveApiConfig'),
  btnSyncApiNow: document.getElementById('btnSyncApiNow'),
  apiStatus: document.getElementById('apiStatus'),
  status: document.getElementById('status'),
  analysisStatus: document.getElementById('analysisStatus'),
  settingsStatus: document.getElementById('settingsStatus'),
  inmailCsvFile: document.getElementById('inmailCsvFile'),
  inmailCsvInfo: document.getElementById('inmailCsvInfo'),
  inmailSubject: document.getElementById('inmailSubject'),
  inmailMessage: document.getElementById('inmailMessage'),
  inmailProgress: document.getElementById('inmailProgress'),
  inmailSentCount: document.getElementById('inmailSentCount'),
  inmailFailedCount: document.getElementById('inmailFailedCount'),
  inmailSkippedCount: document.getElementById('inmailSkippedCount'),
  btnStartInmail: document.getElementById('btnStartInmail'),
  btnStopInmail: document.getElementById('btnStopInmail'),
  btnExportInmailResults: document.getElementById('btnExportInmailResults'),
  statusInmail: document.getElementById('statusInmail'),
};

let saveMessageTimeout = null;
let saveInmailDraftTimeout = null;
let strings = {};
let selectedInmailCsv = '';
let selectedInmailCsvMeta = null;
let selectedTemplateId = '';

const FALLBACK_STRINGS = {
  es: {
    disclaimer: 'Recarga la página de LinkedIn (F5) antes de usar la extensión. Pulsa Iniciar solo cuando los resultados estén cargados. Uso personal.',
    tabConnections: 'Conexiones',
    tabInmail: 'Enviar InMail',
    tabAnalysis: 'Analisis',
    tabSettings: 'Configuraciones',
    connectionCountLabel: 'Solicitudes enviadas',
    followCountLabel: 'Perfiles guardados (Seguir):',
    exportExcelFull: 'Exportar completo',
    exportExcelIncremental: 'Exportar nuevos',
    exportExcelTitle: 'Exportar a CSV/Excel',
    customMessageLabel: 'Mensaje personalizado (usa {{name}} para el nombre)',
    customMessagePlaceholder: 'Hola {{name}}, me gustaría conectar contigo.',
    limitLabel: 'Límite esta sesión',
    limitTitle: '0 = sin límite',
    delayLabel: 'Delay entre invitaciones (seg)',
    hourLimitLabel: 'Límite por hora',
    dayLimitLabel: 'Límite por día',
    debugModeLabel: 'Modo diagnóstico',
    btnStart: 'Iniciar',
    btnStop: 'Detener',
    statusStarting: 'Iniciando…',
    statusActive: 'Activo. No cierres esta pestaña de LinkedIn.',
    statusStopping: 'Deteniendo…',
    statusStopped: 'Detenido.',
    statusNoProfiles: 'No hay perfiles guardados para exportar.',
    statusExported: 'Exportado correctamente.',
    statusError: 'Error',
    statusNoResponse: 'Sin respuesta. ¿Se cerró la pestaña? Prueba de nuevo.',
    statusFinishedLimit: 'Finalizado. Límite de sesión alcanzado.',
    statusFinishedNoMore: 'Finalizado. No hay más resultados para procesar.',
    statusFinished: 'Finalizado.',
    statusFinishedLinkedinLimit: 'Finalizado. LinkedIn alcanzó el límite de solicitudes permitidas.',
    statusFinishedLinkedinLimit429: 'Finalizado. LinkedIn bloqueó envíos por API (HTTP 429).',
    statusFinishedCount: 'Se enviaron {{count}} solicitudes.',
    statusFinishedDetail: 'Detalle: {{detail}}',
    inmailCsvLabel: 'Archivo CSV de perfiles',
    inmailSubjectLabel: 'Asunto predefinido',
    inmailMessageLabel: 'Mensaje predefinido',
    inmailProgressLabel: 'Progreso:',
    inmailSentLabel: 'Enviados:',
    inmailFailedLabel: 'No enviados:',
    inmailSkippedLabel: 'Saltados:',
    btnStartInmail: 'Iniciar lote',
    btnStopInmail: 'Detener lote',
    btnExportInmailResults: 'Exportar resultados InMail',
    statusInmailNeedCsv: 'Selecciona un CSV para iniciar.',
    statusInmailActive: 'Procesando lote InMail...',
    statusInmailStopped: 'Lote detenido.',
    statusInmailFinished: 'Lote finalizado.',
    statusFinishedHourLimit: 'Finalizado. Límite por hora alcanzado.',
    statusFinishedDayLimit: 'Finalizado. Límite por día alcanzado.',
    followRetryProgressLabel: 'Reintento Seguir:',
    followRetrySentLabel: 'Enviados:',
    followRetryFailedLabel: 'Fallidos:',
    followRetrySkippedLabel: 'Saltados:',
    btnStartFollowRetry: 'Procesar Seguir',
    btnStopFollowRetry: 'Detener Seguir',
    analysisFollowHelp: 'Procesar Seguir toma perfiles guardados por boton Seguir, abre cada perfil y solo intenta Conectar.',
    diagnosticHelp: 'Modo diagnostico solo agrega logs en consola ([Connect-In]). No cambia la logica de envios.',
    apiHelp: 'API es opcional: si la activas, la extension envia eventos de actividad a tu endpoint /events con token Bearer.',
  },
  en: {
    disclaimer: 'Reload the LinkedIn page (F5) before using the extension. Click Start only when results are loaded. Personal use only.',
    tabConnections: 'Connections',
    tabInmail: 'Send InMail',
    tabAnalysis: 'Analysis',
    tabSettings: 'Settings',
    connectionCountLabel: 'Requests sent',
    followCountLabel: 'Profiles saved (Follow):',
    exportExcelFull: 'Export full',
    exportExcelIncremental: 'Export new',
    exportExcelTitle: 'Export to CSV/Excel',
    customMessageLabel: 'Custom message (use {{name}} for the name)',
    customMessagePlaceholder: 'Hi {{name}}, I\'d like to connect with you.',
    limitLabel: 'Limit this session',
    limitTitle: '0 = no limit',
    delayLabel: 'Delay between invitations (sec)',
    hourLimitLabel: 'Hourly limit',
    dayLimitLabel: 'Daily limit',
    debugModeLabel: 'Diagnostic mode',
    btnStart: 'Start',
    btnStop: 'Stop',
    statusStarting: 'Starting…',
    statusActive: 'Active. Don\'t close this LinkedIn tab.',
    statusStopping: 'Stopping…',
    statusStopped: 'Stopped.',
    statusNoProfiles: 'No saved profiles to export.',
    statusExported: 'Exported successfully.',
    statusError: 'Error',
    statusNoResponse: 'No response. Did you close the tab? Try again.',
    statusFinishedLimit: 'Completed. Session limit reached.',
    statusFinishedNoMore: 'Completed. No more results to process.',
    statusFinished: 'Completed.',
    statusFinishedLinkedinLimit: 'Completed. LinkedIn limit for invitations was reached.',
    statusFinishedLinkedinLimit429: 'Completed. LinkedIn blocked invitations via API (HTTP 429).',
    statusFinishedCount: '{{count}} requests were sent.',
    statusFinishedDetail: 'Detail: {{detail}}',
    inmailCsvLabel: 'Profiles CSV file',
    inmailSubjectLabel: 'Predefined subject',
    inmailMessageLabel: 'Predefined message',
    inmailProgressLabel: 'Progress:',
    inmailSentLabel: 'Sent:',
    inmailFailedLabel: 'Not sent:',
    inmailSkippedLabel: 'Skipped:',
    btnStartInmail: 'Start batch',
    btnStopInmail: 'Stop batch',
    btnExportInmailResults: 'Export InMail results',
    statusInmailNeedCsv: 'Select a CSV before starting.',
    statusInmailActive: 'Processing InMail batch...',
    statusInmailStopped: 'Batch stopped.',
    statusInmailFinished: 'Batch finished.',
    statusFinishedHourLimit: 'Completed. Hourly limit reached.',
    statusFinishedDayLimit: 'Completed. Daily limit reached.',
    followRetryProgressLabel: 'Retry Follow:',
    followRetrySentLabel: 'Sent:',
    followRetryFailedLabel: 'Failed:',
    followRetrySkippedLabel: 'Skipped:',
    btnStartFollowRetry: 'Process Follow',
    btnStopFollowRetry: 'Stop Follow',
    analysisFollowHelp: 'Process Follow uses profiles captured from Follow buttons, opens each profile, and only tries Connect.',
    diagnosticHelp: 'Diagnostic mode only adds console logs ([Connect-In]). It does not change sending logic.',
    apiHelp: 'API is optional: when enabled, the extension posts activity events to your /events endpoint using Bearer token.',
  },
};

function getLang() {
  const lang = (navigator.language || chrome.i18n?.getUILanguage?.() || 'es').toLowerCase();
  return lang.startsWith('es') ? 'es' : 'en';
}

function t(key) {
  return strings[key] ?? FALLBACK_STRINGS[getLang()]?.[key] ?? key;
}

function tf(key, vars = {}) {
  let out = t(key);
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, String(v));
  return out;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (key && strings[key]) node.textContent = strings[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.getAttribute('data-i18n-placeholder');
    if (key && strings[key]) node.placeholder = strings[key];
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    const key = node.getAttribute('data-i18n-title');
    if (key && strings[key]) node.title = strings[key];
  });
}

function setStatus(text, type = '') {
  el.status.textContent = text;
  el.status.className = 'status' + (type ? ' ' + type : '');
  if (el.analysisStatus) {
    el.analysisStatus.textContent = text;
    el.analysisStatus.className = 'status' + (type ? ' ' + type : '');
  }
  if (el.settingsStatus) {
    el.settingsStatus.textContent = text;
    el.settingsStatus.className = 'status' + (type ? ' ' + type : '');
  }
}

function setInmailStatus(text, type = '') {
  el.statusInmail.textContent = text;
  el.statusInmail.className = 'status' + (type ? ' ' + type : '');
}

function switchTab(mode, { persist = true } = {}) {
  const isConnections = mode === 'connections';
  const isInmail = mode === 'inmail';
  const isAnalysis = mode === 'analysis';
  const isSettings = mode === 'settings';
  el.tabConnections.classList.toggle('active', isConnections);
  el.tabInmail.classList.toggle('active', isInmail);
  if (el.tabAnalysis) el.tabAnalysis.classList.toggle('active', isAnalysis);
  if (el.tabSettings) el.tabSettings.classList.toggle('active', isSettings);
  el.panelConnections.classList.toggle('active', isConnections);
  el.panelInmail.classList.toggle('active', isInmail);
  if (el.panelAnalysis) el.panelAnalysis.classList.toggle('active', isAnalysis);
  if (el.panelSettings) el.panelSettings.classList.toggle('active', isSettings);
  if (persist) chrome.storage.local.set({ lastActiveTab: mode });
}

function parseDelayRange(str) {
  const parts = String(str).split('-').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  if (parts.length >= 2 && parts[0] > 0 && parts[1] >= parts[0]) return { min: parts[0], max: parts[1] };
  if (parts.length === 1 && parts[0] > 0) return { min: parts[0], max: parts[0] };
  return { min: 5, max: 10 };
}

function saveCustomMessage() {
  const value = el.customMessage.value.trim();
  chrome.storage.local.set({ [STORAGE_KEYS.customMessage]: value });
}

function savePopupPreferences() {
  chrome.storage.local.set({
    [STORAGE_KEYS.sessionLimit]: parseInt(el.limit.value, 10) || 0,
    [STORAGE_KEYS.delayRange]: String(el.delayRange.value || '').trim() || '5-10',
  });
}

function saveInmailCsvDraft() {
  if (!selectedInmailCsv) return;
  const payload = {
    text: selectedInmailCsv,
    fileName: selectedInmailCsvMeta?.fileName || '',
    sizeKb: selectedInmailCsvMeta?.sizeKb || 0,
    savedAt: Date.now(),
  };
  chrome.storage.local.set({ [STORAGE_KEYS.inmailCsvDraft]: payload });
}

function loadPopupPreferences() {
  chrome.storage.local.get([STORAGE_KEYS.sessionLimit, STORAGE_KEYS.delayRange, STORAGE_KEYS.inmailCsvDraft], (data) => {
    const savedLimit = Number.parseInt(data[STORAGE_KEYS.sessionLimit], 10);
    if (Number.isFinite(savedLimit) && savedLimit >= 0) {
      el.limit.value = String(savedLimit);
    }
    const savedDelay = String(data[STORAGE_KEYS.delayRange] || '').trim();
    if (savedDelay) {
      el.delayRange.value = savedDelay;
    }
    const inmailDraft = data[STORAGE_KEYS.inmailCsvDraft];
    if (inmailDraft?.text) {
      selectedInmailCsv = String(inmailDraft.text);
      selectedInmailCsvMeta = {
        fileName: String(inmailDraft.fileName || 'CSV guardado'),
        sizeKb: Number(inmailDraft.sizeKb || Math.round(selectedInmailCsv.length / 1024)),
      };
      el.inmailCsvInfo.textContent = `${selectedInmailCsvMeta.fileName} (${selectedInmailCsvMeta.sizeKb} KB)`;
    }
  });
}

function saveInmailDraft() {
  chrome.runtime.sendMessage({
    action: 'saveInmailDraft',
    subject: el.inmailSubject.value.trim(),
    message: el.inmailMessage.value.trim(),
  });
}

function normalizeShortcutValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('control', 'ctrl');
}

function eventToShortcut(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  const key = String(event.key || '').toLowerCase();
  if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
    parts.push(key.length === 1 ? key : key.replace('arrow', ''));
  }
  return parts.join('+');
}

function getDefaultTemplates() {
  return [
    { id: 'base', name: 'Base', text: 'Hola {{name}}, me gustaría conectar contigo para explorar sinergias.' },
    { id: 'saas', name: 'SaaS', text: 'Hola {{name}}, vi tu perfil en SaaS y me gustaría conectar.' },
  ];
}

function renderTemplateSelect(templates) {
  const list = Array.isArray(templates) && templates.length ? templates : getDefaultTemplates();
  el.templateSelect.innerHTML = '';
  for (const item of list) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    el.templateSelect.appendChild(opt);
  }
  if (!selectedTemplateId || !list.some((t) => t.id === selectedTemplateId)) {
    selectedTemplateId = list[0]?.id || '';
  }
  el.templateSelect.value = selectedTemplateId;
  const active = list.find((t) => t.id === selectedTemplateId) || list[0];
  if (active) {
    el.templateName.value = active.name;
    el.templateText.value = active.text;
    el.templatePreview.textContent = active.text.replace(/\{\{name\}\}/gi, 'Prospecto');
  }
}

function loadTemplates() {
  chrome.storage.local.get([STORAGE_KEYS.messageTemplates], (data) => {
    const templates = data[STORAGE_KEYS.messageTemplates];
    renderTemplateSelect(templates);
  });
}

function saveTemplates(templates, cb) {
  chrome.storage.local.set({ [STORAGE_KEYS.messageTemplates]: templates }, () => {
    if (typeof cb === 'function') cb();
  });
}

function saveShortcuts() {
  const shortcuts = {
    startStop: normalizeShortcutValue(el.shortcutStartStop.value),
    followRetry: normalizeShortcutValue(el.shortcutFollowRetry.value),
    toggleDebug: normalizeShortcutValue(el.shortcutToggleDebug.value),
  };
  chrome.storage.local.set({ [STORAGE_KEYS.shortcuts]: shortcuts });
}

function loadShortcuts() {
  chrome.storage.local.get([STORAGE_KEYS.shortcuts], (data) => {
    const shortcuts = data[STORAGE_KEYS.shortcuts] || {
      startStop: 'ctrl+shift+s',
      followRetry: 'ctrl+shift+r',
      toggleDebug: 'ctrl+shift+d',
    };
    el.shortcutStartStop.value = shortcuts.startStop;
    el.shortcutFollowRetry.value = shortcuts.followRetry;
    el.shortcutToggleDebug.value = shortcuts.toggleDebug;
  });
}

function handleShortcut(event) {
  const hit = normalizeShortcutValue(eventToShortcut(event));
  chrome.storage.local.get([STORAGE_KEYS.shortcuts], (data) => {
    const shortcuts = data[STORAGE_KEYS.shortcuts] || {};
    if (!hit) return;
    if (hit === normalizeShortcutValue(shortcuts.startStop)) {
      event.preventDefault();
      if (el.btnStart.disabled) stopConnections();
      else startConnections();
      return;
    }
    if (hit === normalizeShortcutValue(shortcuts.followRetry)) {
      event.preventDefault();
      if (el.btnStartFollowRetry.disabled) stopFollowRetry();
      else startFollowRetry();
      return;
    }
    if (hit === normalizeShortcutValue(shortcuts.toggleDebug)) {
      event.preventDefault();
      el.debugMode.checked = !el.debugMode.checked;
      chrome.runtime.sendMessage({ action: 'setDebugMode', enabled: el.debugMode.checked });
    }
  });
}

function saveFollowRetrySettings() {
  chrome.runtime.sendMessage({
    action: 'saveFollowRetrySettings',
    scoreKeywords: el.scoreKeywords.value.trim(),
    whitelist: el.followWhitelist.value.trim(),
    blacklist: el.followBlacklist.value.trim(),
  });
}

function saveApiConfig() {
  chrome.runtime.sendMessage(
    {
      action: 'saveApiConfig',
      enabled: el.apiEnabled.checked,
      baseUrl: el.apiBaseUrl.value.trim(),
      apiKey: el.apiKey.value.trim(),
    },
    (response) => {
      if (!response?.ok) {
        el.apiStatus.textContent = response?.error || t('statusError');
        return;
      }
      el.apiStatus.textContent = `API guardada.`;
    }
  );
}

function refreshApiStatus() {
  chrome.runtime.sendMessage({ action: 'getApiSyncState' }, (response) => {
    if (!response?.ok) return;
    el.apiEnabled.checked = !!response.apiConfig?.enabled;
    el.apiBaseUrl.value = response.apiConfig?.baseUrl || '';
    el.apiKey.value = response.apiConfig?.apiKey || '';
    const queue = Number(response.queueSize || 0);
    const stops = Number(response.stopStats?.total || 0);
    el.apiStatus.textContent = `Queue API: ${queue} | Stops: ${stops}`;
  });
}

function applyRunStatus(runStatus) {
  if (!runStatus || typeof runStatus !== 'object') return;
  const finishReason = String(runStatus.finishReason || runStatus.reason || '').trim();
  if (runStatus.state === 'running') {
    setStatus(t('statusActive'), 'success');
    el.btnStart.disabled = true;
    el.btnStop.disabled = false;
    return;
  }
  if (runStatus.state === 'stopped') {
    setStatus(t('statusStopped'), 'success');
    el.btnStart.disabled = false;
    el.btnStop.disabled = true;
    return;
  }
  if (runStatus.state === 'finished') {
    if (finishReason === 'stopped_by_user') {
      setStatus(t('statusStopped'), 'success');
      el.btnStart.disabled = false;
      el.btnStop.disabled = true;
      return;
    }
    let base = t('statusFinished');
    if (finishReason === 'limit_reached') base = t('statusFinishedLimit');
    else if (finishReason === 'no_more_results') base = t('statusFinishedNoMore');
    else if (finishReason === 'hour_limit_reached') base = t('statusFinishedHourLimit');
    else if (finishReason === 'day_limit_reached') base = t('statusFinishedDayLimit');
    else if (finishReason === 'linkedin_limit_reached_429') base = t('statusFinishedLinkedinLimit429');
    else if (finishReason === 'linkedin_limit_reached') base = t('statusFinishedLinkedinLimit');
    let message = `${base} ${tf('statusFinishedCount', { count: runStatus.sentThisSession ?? 0 })}`;
    if (runStatus.detail) message += ` ${tf('statusFinishedDetail', { detail: runStatus.detail })}`;
    setStatus(message, 'success');
    el.btnStart.disabled = false;
    el.btnStop.disabled = true;
  }
}

function saveRateLimits() {
  chrome.runtime.sendMessage({
    action: 'saveRateLimits',
    hour: parseInt(el.hourLimit.value, 10) || 0,
    day: parseInt(el.dayLimit.value, 10) || 0,
  });
}

function updateFollowRetryStats(batch) {
  if (!batch) {
    el.followRetryProgress.textContent = '0/0';
    el.followRetrySentCount.textContent = '0';
    el.followRetryFailedCount.textContent = '0';
    el.followRetrySkippedCount.textContent = '0';
    el.btnStartFollowRetry.disabled = false;
    el.btnStopFollowRetry.disabled = true;
    return;
  }
  el.followRetryProgress.textContent = `${batch.cursor || 0}/${batch.total || 0}`;
  el.followRetrySentCount.textContent = String(batch.sent || 0);
  el.followRetryFailedCount.textContent = String(batch.failed || 0);
  el.followRetrySkippedCount.textContent = String(batch.skipped || 0);
  const running = batch.status === 'running';
  el.btnStartFollowRetry.disabled = running;
  el.btnStopFollowRetry.disabled = !running;
}

function refreshFollowRetryStatus() {
  chrome.runtime.sendMessage({ action: 'getFollowRetryStatus' }, (response) => {
    updateFollowRetryStats(response?.batch || null);
    if (response?.settings) {
      el.scoreKeywords.value = response.settings.scoreKeywords || '';
      el.followWhitelist.value = response.settings.whitelist || '';
      el.followBlacklist.value = response.settings.blacklist || '';
    }
  });
}

function startFollowRetry() {
  setStatus(t('statusStarting'), 'success');
  saveFollowRetrySettings();
  const maxRows = parseInt(el.followRetryMaxRows.value, 10) || 0;
  chrome.runtime.sendMessage({ action: 'startFollowRetryBatch', maxRows }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message || t('statusError'), 'error');
      return;
    }
    if (!response?.ok) {
      setStatus(response?.error || t('statusError'), 'error');
      return;
    }
    setStatus(`${t('statusActive')} (${response.total || 0})`, 'success');
    refreshFollowRetryStatus();
  });
}

function stopFollowRetry() {
  chrome.runtime.sendMessage({ action: 'stopFollowRetryBatch' }, () => {
    refreshFollowRetryStatus();
  });
}

function formatCsvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename, header, rows) {
  const csv = '\uFEFF' + header.join(',') + '\n' + rows.map((row) => row.map(formatCsvValue).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename, value) {
  const payload = JSON.stringify(value ?? {}, null, 2);
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportFollowList(mode) {
  chrome.runtime.sendMessage({ action: 'getFollowList', mode, markExported: true }, (response) => {
    const list = response?.list ?? [];
    if (list.length === 0) {
      setStatus(t('statusNoProfiles'), '');
      return;
    }
    const header = ['profile_url', 'full_name', 'headline', 'location', 'query', 'page', 'detected_at', 'status'];
    const rows = list.map((entry) => [
      entry.profile_url,
      entry.full_name,
      entry.headline,
      entry.location,
      entry.query,
      entry.page,
      entry.detected_at,
      entry.status,
    ]);
    downloadCsv(`connect-in-follow-${mode}-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    setStatus(t('statusExported'), 'success');
  });
}

function exportQaEvidence() {
  chrome.runtime.sendMessage({ action: 'exportQaEvidence' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message || t('statusError'), 'error');
      return;
    }
    if (!response?.ok) {
      setStatus(response?.error || t('statusError'), 'error');
      return;
    }
    const datePart = new Date().toISOString().slice(0, 10);
    downloadJson(`connect-in-qa-evidence-${datePart}.json`, response);
    const totalEvents = Number(response?.observability?.events?.length || 0);
    setStatus(`Evidencia QA exportada (${totalEvents} eventos).`, 'success');
  });
}

function startConnections() {
  const limit = parseInt(el.limit.value, 10) || 0;
  const delay = parseDelayRange(el.delayRange.value);
  const hourLimit = parseInt(el.hourLimit.value, 10) || 0;
  const dayLimit = parseInt(el.dayLimit.value, 10) || 0;
  savePopupPreferences();
  saveCustomMessage();
  saveRateLimits();
  el.btnStart.disabled = true;
  el.btnStop.disabled = false;
  setStatus(t('statusStarting'), 'success');
  chrome.runtime.sendMessage(
    {
      action: 'start',
      customMessage: el.customMessage.value.trim(),
      limit,
      delayMin: delay.min,
      delayMax: delay.max,
      hourLimit,
      dayLimit,
      debugMode: el.debugMode.checked,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message || t('statusError'), 'error');
        el.btnStart.disabled = false;
        el.btnStop.disabled = true;
        return;
      }
      if (!response) {
        setStatus(t('statusNoResponse'), 'error');
        el.btnStart.disabled = false;
        el.btnStop.disabled = true;
        return;
      }
      if (response.ok === false) {
        setStatus(response.error || t('statusError'), 'error');
        el.btnStart.disabled = false;
        el.btnStop.disabled = true;
        return;
      }
      setStatus(t('statusActive'), 'success');
    }
  );
}

function stopConnections() {
  el.btnStop.disabled = true;
  setStatus(t('statusStopping'), '');
  chrome.runtime.sendMessage({ action: 'stop' }, () => {
    el.btnStart.disabled = false;
    setStatus(t('statusStopped'), 'success');
  });
}

function readSelectedCsvFile() {
  return new Promise((resolve, reject) => {
    const file = el.inmailCsvFile.files?.[0];
    if (!file) {
      reject(new Error(t('statusInmailNeedCsv')));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo CSV.'));
    reader.readAsText(file, 'utf-8');
  });
}

function updateInmailStats(batch) {
  if (!batch) {
    el.inmailProgress.textContent = '0/0';
    el.inmailSentCount.textContent = '0';
    el.inmailFailedCount.textContent = '0';
    el.inmailSkippedCount.textContent = '0';
    return;
  }
  el.inmailProgress.textContent = `${batch.cursor || 0}/${batch.total || 0}`;
  el.inmailSentCount.textContent = String(batch.sent || 0);
  el.inmailFailedCount.textContent = String(batch.failed || 0);
  el.inmailSkippedCount.textContent = String(batch.skipped || 0);
  const running = batch.status === 'running';
  el.btnStartInmail.disabled = running;
  el.btnStopInmail.disabled = !running;
  if (batch.status === 'running') setInmailStatus(t('statusInmailActive'), 'success');
  if (batch.status === 'stopped') setInmailStatus(t('statusInmailStopped'), '');
  if (batch.status === 'finished') setInmailStatus(t('statusInmailFinished'), 'success');
}

async function startInmailBatch() {
  if (!selectedInmailCsv) {
    try {
      selectedInmailCsv = await readSelectedCsvFile();
    } catch (err) {
      setInmailStatus(err.message || t('statusInmailNeedCsv'), 'error');
      return;
    }
  }
  saveInmailDraft();
  setInmailStatus(t('statusInmailActive'), 'success');
  chrome.runtime.sendMessage(
    {
      action: 'startInmailBatch',
      csvText: selectedInmailCsv,
      subject: el.inmailSubject.value.trim(),
      message: el.inmailMessage.value.trim(),
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setInmailStatus(chrome.runtime.lastError.message || t('statusError'), 'error');
        return;
      }
      if (!response?.ok) {
        setInmailStatus(response?.error || t('statusError'), 'error');
        return;
      }
      setInmailStatus(`${t('statusInmailActive')} (${response.total || 0})`, 'success');
      refreshInmailStatus();
    }
  );
}

function stopInmailBatch() {
  chrome.runtime.sendMessage({ action: 'stopInmailBatch' }, () => {
    setInmailStatus(t('statusInmailStopped'), '');
  });
}

function exportInmailResults() {
  chrome.runtime.sendMessage({ action: 'exportInmailResults' }, (response) => {
    const rows = response?.rows ?? [];
    if (!rows.length) {
      setInmailStatus(t('statusNoProfiles'), '');
      return;
    }
    const header = ['profile_url', 'full_name', 'status', 'reason', 'updated_at', 'ENVIADO', 'NO ENVIADO'];
    const dataRows = rows.map((row) => [
      row.profile_url,
      row.full_name || '',
      row.status || '',
      row.reason || '',
      row.updated_at || '',
      row.status === 'SENT' ? 'TRUE' : 'FALSE',
      row.status === 'FAILED' ? 'TRUE' : 'FALSE',
    ]);
    downloadCsv(`connect-in-inmail-results-${new Date().toISOString().slice(0, 10)}.csv`, header, dataRows);
    setInmailStatus(t('statusExported'), 'success');
  });
}

function refreshInmailStatus() {
  chrome.runtime.sendMessage({ action: 'getInmailBatchStatus' }, (response) => {
    updateInmailStats(response?.batch || null);
  });
}

function bindEvents() {
  el.tabConnections.addEventListener('click', () => switchTab('connections'));
  el.tabInmail.addEventListener('click', () => switchTab('inmail'));
  if (el.tabAnalysis) el.tabAnalysis.addEventListener('click', () => switchTab('analysis'));
  if (el.tabSettings) el.tabSettings.addEventListener('click', () => switchTab('settings'));
  el.btnStart.addEventListener('click', startConnections);
  el.btnStop.addEventListener('click', stopConnections);
  el.btnExportFull.addEventListener('click', () => exportFollowList('full'));
  el.btnExportIncremental.addEventListener('click', () => exportFollowList('incremental'));
  // QA evidence export disabled – preserved for future use
  // if (el.btnExportQaEvidence) {
  //   el.btnExportQaEvidence.addEventListener('click', exportQaEvidence);
  // }
  el.customMessage.addEventListener('input', () => {
    clearTimeout(saveMessageTimeout);
    saveMessageTimeout = setTimeout(saveCustomMessage, 400);
  });
  el.limit.addEventListener('change', savePopupPreferences);
  el.delayRange.addEventListener('change', savePopupPreferences);
  el.hourLimit.addEventListener('change', saveRateLimits);
  el.dayLimit.addEventListener('change', saveRateLimits);
  el.debugMode.addEventListener('change', () => {
    chrome.runtime.sendMessage({ action: 'setDebugMode', enabled: el.debugMode.checked });
  });
  el.btnStartFollowRetry.addEventListener('click', startFollowRetry);
  el.btnStopFollowRetry.addEventListener('click', stopFollowRetry);
  el.scoreKeywords.addEventListener('change', saveFollowRetrySettings);
  el.followWhitelist.addEventListener('change', saveFollowRetrySettings);
  el.followBlacklist.addEventListener('change', saveFollowRetrySettings);
  el.templateSelect.addEventListener('change', () => {
    selectedTemplateId = el.templateSelect.value;
    chrome.storage.local.get([STORAGE_KEYS.messageTemplates], (data) => {
      const templates = data[STORAGE_KEYS.messageTemplates] || getDefaultTemplates();
      const active = templates.find((it) => it.id === selectedTemplateId);
      if (!active) return;
      el.templateName.value = active.name;
      el.templateText.value = active.text;
      el.templatePreview.textContent = active.text.replace(/\{\{name\}\}/gi, 'Prospecto');
    });
  });
  el.templateText.addEventListener('input', () => {
    el.templatePreview.textContent = el.templateText.value.replace(/\{\{name\}\}/gi, 'Prospecto');
  });
  el.btnSaveTemplate.addEventListener('click', () => {
    chrome.storage.local.get([STORAGE_KEYS.messageTemplates], (data) => {
      const templates = (data[STORAGE_KEYS.messageTemplates] || getDefaultTemplates()).slice();
      const name = el.templateName.value.trim() || 'Plantilla';
      const text = el.templateText.value.trim();
      if (!text) return;
      const id = selectedTemplateId || `tpl-${Date.now()}`;
      const idx = templates.findIndex((tItem) => tItem.id === id);
      const next = { id, name, text };
      if (idx >= 0) templates[idx] = next;
      else templates.push(next);
      selectedTemplateId = id;
      saveTemplates(templates, () => {
        renderTemplateSelect(templates);
      });
    });
  });
  el.btnApplyTemplate.addEventListener('click', () => {
    el.customMessage.value = el.templateText.value.trim();
    saveCustomMessage();
    setStatus('Plantilla aplicada al mensaje de conexión.', 'success');
  });
  el.shortcutStartStop.addEventListener('change', saveShortcuts);
  el.shortcutFollowRetry.addEventListener('change', saveShortcuts);
  el.shortcutToggleDebug.addEventListener('change', saveShortcuts);
  document.addEventListener('keydown', handleShortcut);
  // API sync disabled – listeners preserved for future use (see docs/API_SYNC.md)
  // el.btnSaveApiConfig.addEventListener('click', saveApiConfig);
  // el.btnSyncApiNow.addEventListener('click', () => {
  //   chrome.runtime.sendMessage({ action: 'syncApiNow' }, (response) => {
  //     const q = response?.queueSize ?? 0;
  //     el.apiStatus.textContent = `Sincronizado. Pendientes en cola: ${q}`;
  //     refreshApiStatus();
  //   });
  // });
  el.inmailCsvFile.addEventListener('change', async () => {
    selectedInmailCsv = '';
    selectedInmailCsvMeta = null;
    const file = el.inmailCsvFile.files?.[0];
    if (!file) {
      el.inmailCsvInfo.textContent = '';
      return;
    }
    const sizeKb = Math.round(file.size / 1024);
    el.inmailCsvInfo.textContent = `${file.name} (${sizeKb} KB)`;
    try {
      selectedInmailCsv = await readSelectedCsvFile();
      selectedInmailCsvMeta = { fileName: file.name, sizeKb };
      saveInmailCsvDraft();
    } catch (err) {
      setInmailStatus(err.message || t('statusError'), 'error');
    }
  });
  el.inmailSubject.addEventListener('input', () => {
    clearTimeout(saveInmailDraftTimeout);
    saveInmailDraftTimeout = setTimeout(saveInmailDraft, 300);
  });
  el.inmailMessage.addEventListener('input', () => {
    clearTimeout(saveInmailDraftTimeout);
    saveInmailDraftTimeout = setTimeout(saveInmailDraft, 300);
  });
  el.btnStartInmail.addEventListener('click', startInmailBatch);
  el.btnStopInmail.addEventListener('click', stopInmailBatch);
  el.btnExportInmailResults.addEventListener('click', exportInmailResults);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[STORAGE_KEYS.connectionCount]) {
      el.connectionCount.textContent = changes[STORAGE_KEYS.connectionCount].newValue ?? 0;
    }
    if (changes[STORAGE_KEYS.followList]) {
      const list = changes[STORAGE_KEYS.followList].newValue ?? [];
      el.followCount.textContent = list.length;
    }
    if (changes[STORAGE_KEYS.lastRunStatus]) {
      applyRunStatus(changes[STORAGE_KEYS.lastRunStatus].newValue ?? null);
    }
    if (changes.followRetryBatch) {
      updateFollowRetryStats(changes.followRetryBatch.newValue ?? null);
    }
    if (changes.inmailBatch) {
      updateInmailStats(changes.inmailBatch.newValue ?? null);
    }
  });
}

function loadConfig() {
  chrome.runtime.sendMessage({ action: 'getConfig' }, (response) => {
    if (!response) return;
    el.connectionCount.textContent = response.connectionCount ?? 0;
    el.followCount.textContent = (response.followList || []).length;
    el.customMessage.value = response.customMessage || '';
    el.hourLimit.value = String(response.rateLimits?.hour || 0);
    el.dayLimit.value = String(response.rateLimits?.day || 0);
    el.debugMode.checked = !!response.debugMode;
    el.scoreKeywords.value = response.followRetrySettings?.scoreKeywords || '';
    el.followWhitelist.value = response.followRetrySettings?.whitelist || '';
    el.followBlacklist.value = response.followRetrySettings?.blacklist || '';
    // API sync disabled – config loading preserved for future use (see docs/API_SYNC.md)
    // el.apiEnabled.checked = !!response.apiConfig?.enabled;
    // el.apiBaseUrl.value = response.apiConfig?.baseUrl || '';
    // el.apiKey.value = response.apiConfig?.apiKey || '';
    // el.apiStatus.textContent = `Queue API: ${response.apiQueueSize || 0} | Stops: ${response.stopStats?.total || 0}`;
    if (el.settingsStatus) {
      const active = response.activeRuns || {};
      const activeCount = [active.connectRunId, active.followRetryRunId, active.inmailRunId].filter(Boolean).length;
      el.settingsStatus.textContent = `Observabilidad: ${response.qaEventsCount || 0} eventos | trazas activas: ${activeCount}`;
      el.settingsStatus.className = 'status';
    }
    el.inmailSubject.value = response.inmailDraft?.subject || '';
    el.inmailMessage.value = response.inmailDraft?.message || '';
    applyRunStatus(response.lastRunStatus);
    updateFollowRetryStats(response.followRetryBatch || null);
    updateInmailStats(response.inmailBatch || null);
  });
}

async function init() {
  try {
    if (chrome.runtime?.id) {
      const url = chrome.runtime.getURL('i18n/strings.json');
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        strings = data[getLang()] ?? data.es ?? data.en ?? {};
      }
    }
  } catch (_) {}
  if (Object.keys(strings).length === 0) {
    strings = FALLBACK_STRINGS[getLang()] ?? FALLBACK_STRINGS.es;
  }
  applyI18n();
  const VALID_TABS = ['connections', 'inmail', 'analysis', 'settings'];
  const { lastActiveTab } = await chrome.storage.local.get('lastActiveTab');
  switchTab(VALID_TABS.includes(lastActiveTab) ? lastActiveTab : 'connections', { persist: false });
  bindEvents();
  loadPopupPreferences();
  loadTemplates();
  loadShortcuts();
  loadConfig();
  refreshFollowRetryStatus();
  refreshInmailStatus();
  // refreshApiStatus(); // API sync disabled
}

init();
