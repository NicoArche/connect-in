(function () {
  let running = false;
  let config = {
    customMessage: '',
    limit: 0,
    delayMin: 5,
    delayMax: 10,
    hourLimit: 0,
    dayLimit: 0,
    debugMode: false,
  };
  let linkedinApiLimitReached = false;
  let quotaDetectorReady = false;
  let currentRunId = '';

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  let DEBUG = false;
  function debugLog(...args) {
    if (DEBUG) console.log('[Connect-In]', ...args);
  }

  function setupLinkedInQuotaDetector() {
    if (quotaDetectorReady) return;
    quotaDetectorReady = true;
  }

  function isLinkedInApiLimitReached() {
    return linkedinApiLimitReached;
  }

  function getLinkedinLimitReason() {
    return isLinkedInApiLimitReached() ? 'linkedin_limit_reached_429' : 'linkedin_limit_reached';
  }

  async function refreshLinkedInApiLimitState() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'getLinkedinQuotaState' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(linkedinApiLimitReached);
            return;
          }
          if (response?.reached) {
            linkedinApiLimitReached = true;
          }
          resolve(linkedinApiLimitReached);
        });
      } catch (_) {
        resolve(linkedinApiLimitReached);
      }
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || 'runtime_error' });
          return;
        }
        resolve(response || { ok: true });
      });
    });
  }

  async function emitDiag(stage, source, reason, payload = {}, scope = 'connect_loop', runId = currentRunId) {
    try {
      await sendRuntimeMessage({
        action: 'diagEvent',
        stage: String(stage || 'info'),
        source: String(source || 'content'),
        reason: String(reason || ''),
        payload: payload && typeof payload === 'object' ? payload : {},
        scope: String(scope || 'connect_loop'),
        runId: String(runId || ''),
      });
    } catch (_) {}
  }

  // Acciones de interacción: botones y enlaces relevantes (conectar, seguir, etc.)
  function getAllActionsInRoot(root) {
    const items = [];
    function walk(node) {
      if (!node) return;
      if (node.shadowRoot) walk(node.shadowRoot);

      const tag = node.tagName;
      const role = node.getAttribute?.('role') || '';
      const href = node.getAttribute?.('href') || '';

      if (
        tag === 'BUTTON' ||
        role.toLowerCase() === 'button' ||
        (tag === 'A' && href.includes('/preload/search-custom-invite/'))
      ) {
        items.push(node);
      }

      for (let i = 0; i < (node.children?.length || 0); i++) walk(node.children[i]);
    }
    walk(root);
    return items;
  }

  // Búsqueda profunda que también atraviesa Shadow DOM.
  function findAllDeep(selector, root = document.documentElement) {
    const out = [];
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 1 && node.matches?.(selector)) out.push(node);
      if (node.shadowRoot) walk(node.shadowRoot);
      for (let i = 0; i < (node.children?.length || 0); i++) walk(node.children[i]);
    }
    walk(root);
    return out;
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const CONNECT_TEXTS = ['connect', 'conectar', 'invitar', 'invite'];
  const CONNECT_ARIA = ['invite', 'invita a', 'connect', 'conectar', 'send invitation', 'enviar invitacion'];
  const CONNECT_EXCLUDE = ['mensaje', 'message', 'inmail', 'siguiendo', 'following', 'pending', 'pendiente'];

  function getActionSignals(node) {
    const text = normalizeText(node?.textContent || node?.innerText || '');
    const aria = normalizeText(node?.getAttribute?.('aria-label') || '');
    const title = normalizeText(node?.getAttribute?.('title') || '');
    const controlName = normalizeText(node?.getAttribute?.('data-control-name') || '');
    const testId = normalizeText(node?.getAttribute?.('data-test-id') || '');
    return { text, aria, title, controlName, testId, combined: `${text} ${aria} ${title} ${controlName} ${testId}`.trim() };
  }

  function buttonIsConnect(btn) {
    const { text: t, aria, title, controlName, testId, combined } = getActionSignals(btn);
    // Evita confundir "Enviar mensaje/InMail" con acciones de conectar.
    if (CONNECT_EXCLUDE.some((word) => combined.includes(word))) {
      return false;
    }
    if (CONNECT_ARIA.some((label) => aria.includes(label) || title.includes(label))) return true;
    if (controlName.includes('invite') || controlName.includes('connect') || testId.includes('connect')) return true;
    if (!t) return false;
    if (CONNECT_TEXTS.some((label) => t === label || t.startsWith(label + '\n') || t.endsWith('\n' + label))) return true;
    return t.includes('conectar') || t.includes('connect') || t.includes('invitar') || t.includes('invite');
  }

  const FOLLOW_TEXTS = ['follow', 'seguir'];
  const FOLLOW_ARIA = ['follow', 'seguir'];
  const FOLLOW_EXCLUDE = ['siguiendo', 'following']; // No confundir con "Siguiendo"
  const PROCESSED_ATTR = 'data-connectin-follow-processed';
  const CONNECT_PROCESSED_ATTR = 'data-connectin-connect-processed';

  function buttonIsFollow(btn) {
    const { text: t, aria, title, controlName, testId, combined } = getActionSignals(btn);
    if (FOLLOW_EXCLUDE.some((x) => combined.includes(x))) return false;
    if (FOLLOW_ARIA.some((label) => aria.includes(label) || title.includes(label))) return true;
    if (controlName.includes('follow') || testId.includes('follow')) return true;
    if (!t) return false;
    return (t.includes('seguir') && !t.includes('siguiendo')) || (t.includes('follow') && !t.includes('following'));
  }

  function isInProfileCard(btn) {
    const root = getResultsContainer();
    let node = btn;
    for (let i = 0; i < 15 && node && root.contains(node); i++) {
      if (node.querySelector && node.querySelector('a[href*="/in/"]')) return true;
      node = node.parentElement;
    }
    return false;
  }

  function getResultsContainer() {
    return (
      document.querySelector('.scaffold-layout__main') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('.search-results-container') ||
      document.querySelector('[class*="search-results"]') ||
      document.querySelector('.scaffold-layout__content') ||
      document.body
    );
  }

  function hasObviousProfilePhoto(connectAction) {
    const card =
      connectAction?.closest?.('.entity-result') ||
      connectAction?.closest?.('[data-chameleon-result-urn]') ||
      connectAction?.closest?.('li.reusable-search__result-container') ||
      connectAction?.closest?.('.reusable-search__entity-result-list li') ||
      connectAction?.closest?.('.reusable-search__entity-result-list > div') ||
      connectAction?.closest?.('[class*="entity-result"]') ||
      connectAction?.closest?.('li') ||
      null;
    if (!card) return true; // Tolerante: si no detectamos card, no bloqueamos.

    const profileImg = card.querySelector(
      'img.presence-entity__image, img[class*="EntityPhoto"], img[data-anonymize="headshot-photo"], img'
    );
    if (profileImg && isElementVisible(profileImg)) {
      const delayedCandidates = [
        profileImg.getAttribute('data-delayed-url'),
        profileImg.getAttribute('data-ghost-url'),
        profileImg.getAttribute('data-li-src'),
      ]
        .map((v) => (v || '').trim().toLowerCase())
        .filter(Boolean);
      const rawSrc = (profileImg.getAttribute('src') || '').trim().toLowerCase();
      const bestSrc = delayedCandidates.find((src) => !src.includes('ghost') && !src.includes('placeholder') && !src.includes('default')) || rawSrc;
      if (bestSrc && !bestSrc.includes('ghost') && !bestSrc.includes('placeholder') && !bestSrc.includes('default')) {
        return true;
      }
      const imageLikelyLoading =
        profileImg.complete === false ||
        profileImg.classList?.contains('lazy-image') ||
        profileImg.getAttribute('loading') === 'lazy';
      // Si parece carga diferida o lazy-loading, no bloquear para reducir falsos negativos.
      if (imageLikelyLoading || delayedCandidates.length > 0) {
        return true;
      }
      // Si hay imagen visible con src vacío o placeholder sin señales de carga, lo consideramos "sin foto obvia".
      if (!bestSrc || bestSrc.includes('ghost') || bestSrc.includes('placeholder') || bestSrc.includes('default')) {
        return false;
      }
    }

    const obviousNoPhoto = card.querySelector(
      '.ivm-view-attr__img--initials, .presence-entity__image--initials, [class*="initials"]'
    );
    if (obviousNoPhoto && isElementVisible(obviousNoPhoto)) {
      const initialsText = (obviousNoPhoto.textContent || '').replace(/\s+/g, '');
      if (/^[A-Za-z]{1,4}$/.test(initialsText)) return false;
    }

    // Tolerante: si no encontramos señal clara de "sin foto", permitimos conectar.
    return true;
  }

  function getConnectButtons() {
    const isEligibleConnect = (b) =>
      !!b &&
      buttonIsConnect(b) &&
      hasObviousProfilePhoto(b) &&
      isElementVisible(b) &&
      !b.disabled &&
      !b.getAttribute(CONNECT_PROCESSED_ATTR);

    const root = getResultsContainer();
    const ariaSelectors = [
      'button[aria-label*="onnect" i]',
      'button[aria-label*="onectar" i]',
      'button[aria-label*="nvite" i]',
      'button[aria-label*="nviar" i]',
      'button[data-control-name*="invite" i]',
      'button[data-control-name*="connect" i]',
      '[role="button"][aria-label*="onnect" i]',
      '[role="button"][aria-label*="onectar" i]',
      'a[aria-label*="onectar" i]',
      'a[aria-label*="nvita a" i]',
    ];
    for (const sel of ariaSelectors) {
      try {
        const btns = queryDeepInRoot(root, sel);
        const filtered = [...btns].filter((b) => (isInProfileCard(b) || b.closest('main, [role="main"]')) && isEligibleConnect(b));
        if (filtered.length > 0) return filtered;
      } catch (_) {}
    }
    const listSelectors = [
      '.reusable-search__entity-result-list li',
      '.reusable-search__entity-result-list > div',
      '.reusable-search__entity-result-list [class*="entity-result"]',
      'li.reusable-search__result-container',
      '.entity-result',
      '[data-chameleon-result-urn]',
      '.search-results__list-item',
      'li[class*="reusable-search"]',
      'div[class*="entity-result"]',
      '[class*="entity-result"]',
    ];
    for (const sel of listSelectors) {
      try {
        const cards = root.querySelectorAll(sel);
        if (cards.length > 0) {
          const out = [];
          for (const card of cards) {
            const actions = getAllActionsInRoot(card);
            const connectBtn = actions.find(isEligibleConnect);
            if (connectBtn) out.push(connectBtn);
          }
          if (out.length > 0) return out;
        }
      } catch (_) {}
    }
    const allActions = getAllActionsInRoot(root);
    const connectButtons = allActions.filter(isEligibleConnect);
    const inProfile = connectButtons.filter(isInProfileCard);
    return inProfile.length > 0 ? inProfile : connectButtons;
  }

  function getFollowButtons() {
    const root = getResultsContainer();
    const ariaSelectors = [
      'button[aria-label*="ollow" i]',
      'button[aria-label*="eguir" i]',
      'button[data-control-name*="follow" i]',
      '[role="button"][aria-label*="ollow" i]',
      '[role="button"][aria-label*="eguir" i]',
      'a[aria-label*="eguir a" i]',
    ];
    for (const sel of ariaSelectors) {
      try {
        const btns = queryDeepInRoot(root, sel);
        const filtered = [...btns].filter((b) => {
          if (b.closest(`[${PROCESSED_ATTR}]`)) return false;
          const { aria: label, combined } = getActionSignals(b);
          if (label.includes('following') || label.includes('siguiendo')) return false;
          if (combined.includes('siguiendo') || combined.includes('following')) return false;
          return isInProfileCard(b);
        });
        if (filtered.length > 0) return filtered;
      } catch (_) {}
    }
    const listSelectors = [
      '.reusable-search__entity-result-list li',
      '.reusable-search__entity-result-list > div',
      'li.reusable-search__result-container',
      '.entity-result',
      '[data-chameleon-result-urn]',
      'div[class*="entity-result"]',
      '[class*="entity-result"]',
    ];
    for (const sel of listSelectors) {
      try {
        const cards = root.querySelectorAll(sel);
        if (cards.length > 0) {
          const out = [];
          for (const card of cards) {
            if (card.getAttribute(PROCESSED_ATTR)) continue;
            const actions = getAllActionsInRoot(card);
            const followBtn = actions.find(buttonIsFollow);
            if (followBtn) out.push(followBtn);
          }
          if (out.length > 0) return out;
        }
      } catch (_) {}
    }
    const allActions = getAllActionsInRoot(root);
    return allActions.filter((btn) => {
      if (btn.closest(`[${PROCESSED_ATTR}]`)) return false;
      return buttonIsFollow(btn) && isInProfileCard(btn);
    });
  }

  function getProfileInfoFromButton(button) {
    const card = button.closest('.entity-result') ||
      button.closest('[data-chameleon-result-urn]') ||
      button.closest('li.reusable-search__result-container') ||
      button.closest('.reusable-search__entity-result-list li') ||
      button.closest('.reusable-search__entity-result-list > div') ||
      button.closest('[class*="entity-result"]') ||
      button.closest('li') ||
      button.parentElement;
    const root = card || button;
    let link = root.querySelector('a[href*="/in/"]');
    if (!link) {
      let n = button.parentElement;
      for (let i = 0; i < 20 && n; i++) {
        link = n.querySelector?.('a[href*="/in/"]');
        if (link) break;
        n = n.parentElement;
      }
    }
    if (!link) return { url: '', name: '' };
    const href = link.getAttribute('href') || '';
    const fullUrl = href.startsWith('http') ? href : 'https://www.linkedin.com' + (href.startsWith('/') ? href : '/' + href);
    const nameCandidates = [
      root.querySelector('.entity-result__title-text a span[aria-hidden="true"]')?.textContent || '',
      root.querySelector('.entity-result__title-text a span[dir="ltr"]')?.textContent || '',
      root.querySelector('.entity-result__title-text a span:not(.visually-hidden):not([class*="hidden"])')?.textContent || '',
      root.querySelector('.entity-result__title-text a .visually-hidden')?.textContent || '',
      root.querySelector('.entity-result__title-text a')?.textContent || '',
      root.querySelector('.entity-result__title-line a')?.textContent || '',
      root.querySelector('[data-test-id="profile-card-title"]')?.textContent || '',
      link.textContent || '',
      link.getAttribute('aria-label') || '',
      link.getAttribute('title') || '',
    ]
      .map((v) => String(v || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const fullName = nameCandidates.map((candidate) => sanitizeDisplayName(candidate)).find(Boolean) || '';
    debugLog('getProfileInfoFromButton', { fullName, firstCandidate: nameCandidates[0] || '(empty)', candidateCount: nameCandidates.length });
    const name = fullName.split(/\s+/)[0] || '';
    const headlineEl = root.querySelector('.entity-result__primary-subtitle, .t-14.t-normal, [data-test-id="result-lockup-subtitle"]');
    const locationEl = root.querySelector('.entity-result__secondary-subtitle, .t-12.t-normal, [data-test-id="result-lockup-metadata"]');
    return {
      url: fullUrl,
      name,
      fullName,
      headline: (headlineEl?.textContent || '').trim(),
      location: (locationEl?.textContent || '').trim(),
    };
  }

  function getSearchContext() {
    try {
      const current = new URL(window.location.href);
      const query = current.searchParams.get('keywords') || current.searchParams.get('q') || '';
      const page = Number.parseInt(current.searchParams.get('page') || '1', 10);
      return { query, page: Number.isFinite(page) ? page : 1 };
    } catch (_) {
      return { query: '', page: 1 };
    }
  }

  function normalizeSearchUrl(rawUrl) {
    try {
      const u = new URL(rawUrl || window.location.href);
      u.hash = '';
      return u.toString();
    } catch (_) {
      return String(rawUrl || window.location.href || '').split('#')[0];
    }
  }

  function getVisibleResultProfileUrls(limit = 3) {
    const links = document.querySelectorAll(
      '.reusable-search__entity-result-list a[href*="/in/"], [data-chameleon-result-urn] a[href*="/in/"], a[href*="/in/"]'
    );
    const urls = [];
    const seen = new Set();
    for (const link of links) {
      if (!isElementVisible(link)) continue;
      const href = (link.getAttribute('href') || '').trim();
      if (!href.includes('/in/')) continue;
      const absolute = href.startsWith('http')
        ? href
        : `https://www.linkedin.com${href.startsWith('/') ? '' : '/'}${href}`;
      let normalized = '';
      try {
        const parsed = new URL(absolute);
        normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
      } catch (_) {
        continue;
      }
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length >= limit) break;
    }
    return urls;
  }

  function getSearchProgressSnapshot() {
    const ctx = getSearchContext();
    return {
      query: (ctx.query || '').trim().toLowerCase(),
      page: Number.isFinite(ctx.page) ? ctx.page : 1,
      url: normalizeSearchUrl(window.location.href),
      resultSignature: getVisibleResultProfileUrls(3).join('|'),
    };
  }

  function didSearchProgressAdvance(previousSnapshot, nextSnapshot) {
    if (!previousSnapshot || !nextSnapshot) return false;
    if (nextSnapshot.page > previousSnapshot.page) return true;
    if (nextSnapshot.resultSignature && nextSnapshot.resultSignature !== previousSnapshot.resultSignature) return true;
    return false;
  }

  function getPaginationNavigationInfo() {
    const currentPage = getSearchContext().page;
    const pageIndicators = document.querySelectorAll(
      '.artdeco-pagination__indicator--number button, .artdeco-pagination__indicator--number, li.artdeco-pagination__indicator button'
    );
    let maxNumberedPage = 0;
    for (const indicator of pageIndicators) {
      const text = (indicator.textContent || indicator.getAttribute?.('aria-label') || '').trim();
      const parsed = Number.parseInt(text.replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(parsed) && parsed > maxNumberedPage) {
        maxNumberedPage = parsed;
      }
    }
    const nextEnabled = !!(
      document.querySelector('.artdeco-pagination__button--next:not([disabled])') ||
      document.querySelector('button[aria-label="Siguiente"]:not([disabled])') ||
      document.querySelector('button[aria-label="Next"]:not([disabled])') ||
      document.querySelector('button[aria-label="Next page"]:not([disabled])')
    );
    return {
      currentPage: Number.isFinite(currentPage) ? currentPage : 1,
      maxNumberedPage,
      nextEnabled,
    };
  }

  function buildNextSearchPageUrl() {
    try {
      const current = new URL(window.location.href);
      if (!current.pathname.includes('/search/results/people')) return '';
      const currentPage = Number.parseInt(current.searchParams.get('page') || '1', 10);
      const nextPage = Number.isFinite(currentPage) && currentPage > 0 ? currentPage + 1 : 2;
      current.searchParams.set('page', String(nextPage));
      return current.toString();
    } catch (_) {
      return '';
    }
  }

  async function goToNextResultsPage() {
    const before = getSearchProgressSnapshot();
    const paginationInfo = getPaginationNavigationInfo();
    const nextBtn =
      document.querySelector('.artdeco-pagination__button--next:not([disabled])') ||
      document.querySelector('button[aria-label="Siguiente"]:not([disabled])') ||
      document.querySelector('button[aria-label="Next"]:not([disabled])') ||
      document.querySelector('button[aria-label="Next page"]:not([disabled])') ||
      document.querySelector('button[aria-label*="siguiente" i]:not([disabled])') ||
      document.querySelector('button[aria-label*="next" i]:not([disabled])') ||
      [...document.querySelectorAll('button')].find((b) => {
        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
        return (label.includes('siguiente') || label.includes('next page') || label === 'next') && !b.disabled;
      });

    const previousPageUrl = window.location.href;
    if (nextBtn) {
      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(500);
      nextBtn.click();
      await delay(randomBetween(Math.max(config.delayMin, 3) * 1000, Math.max(config.delayMax, 5) * 1000));

      for (let i = 0; i < 12 && running; i++) {
        await delay(500);
        const after = getSearchProgressSnapshot();
        if (didSearchProgressAdvance(before, after)) {
          return true;
        }
      }
    }

    const fallbackUrl = buildNextSearchPageUrl();
    const normalizedFallbackUrl = normalizeSearchUrl(fallbackUrl);
    const canUseFallback =
      !!normalizedFallbackUrl &&
      normalizedFallbackUrl !== normalizeSearchUrl(previousPageUrl) &&
      (paginationInfo.maxNumberedPage <= 0 || paginationInfo.currentPage < paginationInfo.maxNumberedPage);
    if (canUseFallback) {
      window.location.href = fallbackUrl;
      await delay(randomBetween(Math.max(config.delayMin, 3) * 1000, Math.max(config.delayMax, 5) * 1000));
      for (let i = 0; i < 12 && running; i++) {
        await delay(500);
        const after = getSearchProgressSnapshot();
        if (didSearchProgressAdvance(before, after)) {
          return true;
        }
      }
    }
    return false;
  }

  function hasSearchLoadingIndicators() {
    return !!(
      document.querySelector('.artdeco-loader') ||
      document.querySelector('.search-results-container [aria-busy="true"]') ||
      document.querySelector('[role="main"][aria-busy="true"]') ||
      document.querySelector('.reusable-search__result-container--loading')
    );
  }

  function getCardFromActionButton(button) {
    if (!button) return null;
    return button.closest('.entity-result') ||
      button.closest('[data-chameleon-result-urn]') ||
      button.closest('li.reusable-search__result-container') ||
      button.closest('.reusable-search__entity-result-list li') ||
      button.closest('.reusable-search__entity-result-list > div') ||
      button.closest('[class*="entity-result"]') ||
      button.closest('li') ||
      button.parentElement ||
      null;
  }

  function cardStillHasConnectAction(button) {
    const card = getCardFromActionButton(button);
    if (!card) return false;
    const actions = getAllActionsInRoot(card);
    // LinkedIn suele dejar acciones "Connect" ocultas en plantillas internas del card.
    // Para confirmar si aún está disponible, solo tomamos controles visibles y habilitados.
    return actions.some((actionBtn) => {
      if (!buttonIsConnect(actionBtn)) return false;
      if (!isElementVisible(actionBtn)) return false;
      return !actionBtn.disabled;
    });
  }

  function getProfileNameForButton(connectButton) {
    const card = connectButton.closest('.entity-result') ||
      connectButton.closest('[data-chameleon-result-urn]') ||
      connectButton.closest('li.reusable-search__result-container') ||
      connectButton.closest('.reusable-search__entity-result-list li') ||
      connectButton.closest('.reusable-search__entity-result-list > div') ||
      connectButton.closest('li') ||
      connectButton.parentElement;
    const root = card || connectButton;
    const selectors = [
      '.entity-result__title-text a',
      '.entity-result__title-line a',
      '[data-test-id="profile-card-title"]',
      'a[href*="/in/"]',
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) {
        const name = sanitizeDisplayName(el.textContent || '');
        if (name) return name;
      }
    }
    let node = connectButton.parentElement;
    for (let i = 0; i < 10 && node; i++) {
      const link = node.querySelector('a[href*="/in/"]');
      if (link) {
        const name = sanitizeDisplayName(link.textContent || '');
        if (name) return name;
      }
      node = node.parentElement;
    }
    return '';
  }

  const ADD_NOTE_LABELS = [
    'Add a note',
    'Añadir nota',
    'Añadir una nota',
    'Agregar nota',
    'Ajouter une note',
    'Adicionar nota',
  ];
  function getAddNoteButton(rootNode) {
    const root = rootNode || document;
    const byAria = root.querySelector(
      'button[aria-label="Add a note"], button[aria-label="Añadir nota"], button[aria-label="Añadir una nota"]'
    );
    if (byAria && !byAria.disabled && byAria.getAttribute('aria-disabled') !== 'true') return byAria;
    const buttons = root.querySelectorAll('button');
    return (
      [...buttons].find((el) => {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const txt = (el.textContent || '').trim();
        return ADD_NOTE_LABELS.some((l) => txt === l || txt.includes(l));
      }) || null
    );
  }

  function getMessageTextarea(rootNode) {
    const root = rootNode || document;
    // Campo dentro del modal de invitación (textarea o contenteditable)
    const modal = root.querySelector('.artdeco-modal, [role="dialog"]') || root;
    if (modal) {
      const ta =
        modal.querySelector('textarea#custom-message') ||
        modal.querySelector('textarea[name="message"]') ||
        modal.querySelector('textarea');
      if (ta) return ta;
      const editable =
        modal.querySelector('[contenteditable="true"][role="textbox"]') ||
        modal.querySelector('[contenteditable="true"]');
      if (editable) return editable;
    }
    // Fallback global
    const globalTa = root.querySelector('textarea') || document.querySelector('textarea');
    if (globalTa) return globalTa;
    return (
      root.querySelector('[contenteditable="true"][role="textbox"]') ||
      root.querySelector('[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"]') ||
      null
    );
  }

  const SEND_LABELS = ['Send', 'Enviar', 'Done', 'Listo', 'Hecho', 'Send now', 'Enviar ahora', 'Envoyer'];
  function getSendButton(rootNode) {
    const root = rootNode || document;
    const byAria = root.querySelector('button[aria-label="Send now"], button[aria-label="Send invitation"], button[aria-label="Done"], button[aria-label="Envoyer"], button[aria-label="Enviar"]');
    if (byAria && !byAria.disabled && byAria.getAttribute('aria-disabled') !== 'true') return byAria;
    const buttons = root.querySelectorAll('button');
    return [...buttons].find((el) => {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      return SEND_LABELS.some((l) => (el.textContent || '').trim().includes(l));
    }) || null;
  }

  // Botón de envío con nota (evita "Enviar sin nota")
  function getSendWithNoteButton(modalRoot) {
    if (!modalRoot) return null;
    const byAria = modalRoot.querySelector(
      'button[aria-label="Enviar invitación"], button[aria-label="Send invitation"], button[aria-label="Enviar"]'
    );
    if (byAria && !byAria.disabled && byAria.getAttribute('aria-disabled') !== 'true') return byAria;
    const buttons = modalRoot.querySelectorAll('button');
    return (
      [...buttons].find((el) => {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const txt = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        if (txt.includes('sin nota') || aria.includes('sin nota') || aria.includes('without a note')) return false;
        return txt === 'enviar' || txt.includes('send') || aria.includes('enviar invitación') || aria.includes('send invitation');
      }) || null
    );
  }

  // Botón específico de "Enviar sin nota" en el modal de invitación
  function getSendWithoutNoteButton(modalRoot) {
    const root = modalRoot || document.documentElement;
    const byAria = root.querySelector(
      'button[aria-label="Enviar sin nota"], button[aria-label="Send without a note"]'
    );
    if (byAria && !byAria.disabled && byAria.getAttribute('aria-disabled') !== 'true') return byAria;
    const buttons = root.querySelectorAll('button');
    return (
      [...buttons].find((el) => {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const txt = (el.textContent || '').trim().toLowerCase();
        return txt.includes('enviar sin nota') || txt.includes('send without a note');
      }) || null
    );
  }

  const DISMISS_LABELS = ['Dismiss', 'Descartar', 'Cerrar', 'Fermer', 'Close'];
  function getDismissButton() {
    const byAria = document.querySelector('button[aria-label="Dismiss"], button[aria-label="Cerrar"]');
    if (byAria) return byAria;
    const byClass = document.querySelector('.artdeco-modal__dismiss');
    if (byClass) return byClass;
    const buttons = document.querySelectorAll('button');
    return [...buttons].find((el) => {
      const t = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      return DISMISS_LABELS.some((l) => t.includes(l) || aria.includes(l));
    }) || null;
  }

  function closeModal() {
    const dismiss = getDismissButton();
    if (dismiss) dismiss.click();
  }

  const LINKEDIN_LIMIT_TEXTS = [
    'has alcanzado el límite',
    'has alcanzado el limite',
    'no puedes enviar más invitaciones',
    'no puedes enviar mas invitaciones',
    'you have reached the weekly invitation limit',
    'you\'ve reached the weekly invitation limit',
    'you can no longer send invitations',
    'you can\'t send invitations',
    'try again next week',
    'vuelve a intentarlo la próxima semana',
    'vuelve a intentarlo la proxima semana',
  ];

  const LINKEDIN_WARNING_TEXTS = [
    'te quedan pocas',
    'pocas invitaciones',
    'acercando al limite',
    'acercando al límite',
    'approaching your',
    'running low',
    'invitations left',
    'quedan pocas invitaciones',
    'you\'re approaching',
    'you are approaching',
  ];

  function normalizeText(value) {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  const INVITE_CONFIRMATION_TEXTS = [
    'invitation sent',
    'invitacion enviada',
    'invitation pending',
    'solicitud enviada',
    'request sent',
    'pending',
    'pendiente',
    'withdraw',
    'retirar',
  ];

  const INMAIL_CONFIRMATION_TEXTS = [
    'mensaje enviado',
    'message sent',
    'sent successfully',
    'se envio tu mensaje',
  ];

  function nodeHasAnyConfirmationText(node, phrases) {
    if (!node) return false;
    const text = normalizeText(node.textContent || '');
    return phrases.some((phrase) => text.includes(normalizeText(phrase)));
  }

  function hasLiveFeedbackText(phrases) {
    const feedbackNodes = findAllDeep(
      '[role="alert"], [role="status"], [aria-live], .artdeco-toast-item, .artdeco-toast-item__message, .artdeco-inline-feedback__message'
    );
    for (const node of feedbackNodes) {
      if (nodeHasAnyConfirmationText(node, phrases)) return true;
    }
    return false;
  }

  function getConnectActionScope(connectButton) {
    return (
      connectButton?.closest?.('.entity-result') ||
      connectButton?.closest?.('[data-chameleon-result-urn]') ||
      connectButton?.closest?.('li.reusable-search__result-container') ||
      connectButton?.closest?.('.reusable-search__entity-result-list li') ||
      connectButton?.closest?.('.pv-top-card') ||
      connectButton?.closest?.('main') ||
      document
    );
  }

  function hasInviteUiConfirmationSignal(connectButton) {
    if (hasLiveFeedbackText(INVITE_CONFIRMATION_TEXTS)) return true;
    const scope = getConnectActionScope(connectButton);
    const actionNodes = queryDeepInRoot(scope, 'button, [role="button"], a[role="button"], span');
    for (const node of actionNodes) {
      if (!isElementVisible(node)) continue;
      const combined = `${node.textContent || ''} ${node.getAttribute?.('aria-label') || ''}`;
      if (nodeHasAnyConfirmationText({ textContent: combined }, INVITE_CONFIRMATION_TEXTS)) {
        return true;
      }
    }
    return false;
  }

  function hasInmailUiConfirmationSignal(root) {
    if (root && composerLooksLikeSentState(root)) return true;
    return hasLiveFeedbackText(INMAIL_CONFIRMATION_TEXTS);
  }

  function isLinkedInLimitReached(scopeNode) {
    if (!scopeNode || scopeNode === document || scopeNode === document.body) return false;
    const text = normalizeText(scopeNode.textContent || '');
    return LINKEDIN_LIMIT_TEXTS.some((t) => text.includes(normalizeText(t)));
  }

  function isLinkedInWarningDialog(dialogNode) {
    if (!dialogNode) return false;
    const text = normalizeText(dialogNode.textContent || '');
    if (LINKEDIN_LIMIT_TEXTS.some((t) => text.includes(normalizeText(t)))) return false;
    return LINKEDIN_WARNING_TEXTS.some((t) => text.includes(normalizeText(t)));
  }

  function findLinkedInWarningDialog() {
    const dialogs = findAllDeep('.artdeco-modal[role="dialog"], [role="dialog"]');
    for (const dialog of dialogs) {
      if (!isElementVisible(dialog)) continue;
      if (isLinkedInWarningDialog(dialog)) return dialog;
    }
    return null;
  }

  async function dismissWarningDialogIfPresent() {
    const warning = findLinkedInWarningDialog();
    if (!warning) return false;
    debugLog('LinkedIn warning dialog detected, dismissing');
    const dismissSelectors = [
      'button[aria-label*="Got it" i]',
      'button[aria-label*="Entendido" i]',
      'button[aria-label*="Dismiss" i]',
      'button[aria-label*="Cerrar" i]',
      'button[aria-label*="OK" i]',
      '.artdeco-modal__dismiss',
    ];
    for (const sel of dismissSelectors) {
      const btn = warning.querySelector(sel);
      if (btn && isElementVisible(btn)) {
        btn.click();
        await delay(500);
        return true;
      }
    }
    const buttons = warning.querySelectorAll('button');
    for (const btn of buttons) {
      if (!isElementVisible(btn) || btn.disabled) continue;
      const txt = normalizeText(btn.textContent || '');
      const aria = normalizeText(btn.getAttribute('aria-label') || '');
      const combined = `${txt} ${aria}`;
      if (
        combined.includes('entendido') || combined.includes('got it') ||
        combined.includes('ok') || combined.includes('aceptar') ||
        combined.includes('accept') || combined.includes('continue') ||
        combined.includes('continuar') || combined.includes('dismiss') ||
        combined.includes('cerrar') || combined.includes('close')
      ) {
        btn.click();
        await delay(500);
        return true;
      }
    }
    const anyBtn = [...buttons].find((b) => isElementVisible(b) && !b.disabled);
    if (anyBtn) {
      anyBtn.click();
      await delay(500);
      return true;
    }
    return false;
  }

  function findLinkedInLimitDialog() {
    const dialogs = findAllDeep('.artdeco-modal[role="dialog"], [role="dialog"].artdeco-modal, [role="dialog"]');
    for (const dialog of dialogs) {
      if (!isElementVisible(dialog)) continue;
      if (isLinkedInWarningDialog(dialog)) continue;
      if (
        dialog.classList?.contains('ip-fuse-limit-alert') ||
        dialog.querySelector('#ip-fuse-limit-alert__header') ||
        dialog.querySelector('.ip-fuse-limit-alert__primary-action') ||
        isLinkedInLimitReached(dialog)
      ) {
        return dialog;
      }
    }
    return null;
  }

  function findInviteDialog() {
    const dialogs = findAllDeep('.artdeco-modal.send-invite[role="dialog"], .artdeco-modal[role="dialog"][data-test-modal]');
    for (const dialog of dialogs) {
      if (!isElementVisible(dialog)) continue;
      if (findLinkedInLimitDialog() === dialog || dialog.classList?.contains('ip-fuse-limit-alert')) continue;
      if (isLinkedInLimitReached(dialog)) continue;
      return dialog;
    }
    return null;
  }

  async function waitInviteOutcome(connectButton) {
    let sawNoConnectWithoutSignal = false;
    for (let i = 0; i < 24; i++) {
      if (i % 4 === 0) {
        await refreshLinkedInApiLimitState();
      }
      const limitDialog = findLinkedInLimitDialog();
      if (limitDialog || isLinkedInApiLimitReached()) {
        return { sentOk: false, linkedinLimitReached: true, reason: getLinkedinLimitReason() };
      }
      const inviteDialogOpen = !!findInviteDialog();
      const connectStillAvailable = cardStillHasConnectAction(connectButton);
      const confirmedBySignal = hasInviteUiConfirmationSignal(connectButton);
      if (!inviteDialogOpen && !connectStillAvailable && confirmedBySignal) {
        return { sentOk: true, linkedinLimitReached: false, reason: '' };
      }
      if (!inviteDialogOpen && !connectStillAvailable && !confirmedBySignal) {
        sawNoConnectWithoutSignal = true;
      }
      await delay(250);
    }
    const timeoutReason = sawNoConnectWithoutSignal ? 'invite_confirmation_signal_missing' : 'invite_confirmation_timeout';
    await emitDiag('timeout', 'waitInviteOutcome', timeoutReason, { action: 'waitInviteOutcome' });
    return {
      sentOk: false,
      linkedinLimitReached: false,
      reason: timeoutReason,
    };
  }

  // Espera corta solo para que abra el modal; el delay largo va entre invitaciones en runLoop
  const MODAL_WAIT_MS = { min: 1500, max: 2500 };

  async function sendInvite(connectButton, firstName) {
    setupLinkedInQuotaDetector();
    await refreshLinkedInApiLimitState();
    connectButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(400);
    if (!running) return;
    connectButton.click();
    await delay(randomBetween(MODAL_WAIT_MS.min, MODAL_WAIT_MS.max));

    let sentOk = false;
    let linkedinLimitReached = false;
    let limitCause = '';
    let failureReason = '';
    let modal = null;

    await dismissWarningDialogIfPresent();

    // 1) Esperar modal inicial o modal de límite.
    for (let i = 0; i < 12 && !modal; i++) {
      await dismissWarningDialogIfPresent();
      const limitDialog = findLinkedInLimitDialog();
      if (limitDialog) {
        linkedinLimitReached = true;
        failureReason = 'linkedin_limit_dialog';
        modal = limitDialog;
        break;
      }
      modal = findInviteDialog();
      debugLog('sendInvite: wait modal intento', i + 1, 'modal=', !!modal, 'limit=', linkedinLimitReached);
      if (!modal) {
        await delay(300);
      }
    }

    if (
      linkedinLimitReached ||
      (modal && isLinkedInLimitReached(modal)) ||
      isLinkedInApiLimitReached()
    ) {
      linkedinLimitReached = true;
      if (isLinkedInApiLimitReached()) {
        limitCause = 'api_429';
        failureReason = 'linkedin_limit_api_429';
      } else {
        limitCause = 'ui_limit';
        failureReason = failureReason || 'linkedin_limit_ui';
      }
    }

    const resolvedMessage = applyNameTemplate(config.customMessage, firstName).trim();
    const templateHasNameToken = /\{\{\s*name\s*\}\}/i.test(String(config.customMessage || ''));
    debugLog('name-template', {
      firstNameCandidate: firstName || '',
      templateHasNameToken,
      resolvedMessageLength: resolvedMessage.length,
      resolvedMessagePreview: resolvedMessage.slice(0, 100),
    });

    // 2) Intento principal: añadir nota + enviar con nota
    if (!linkedinLimitReached && modal && resolvedMessage) {
      const addNoteBtn = getAddNoteButton(modal);
      debugLog('sendInvite: addNoteBtn=', !!addNoteBtn);
      if (addNoteBtn) {
        addNoteBtn.click();
        await delay(700);

        let messageField = null;
        for (let i = 0; i < 10 && !messageField; i++) {
          modal = findAllDeep('.artdeco-modal.send-invite[role="dialog"], .artdeco-modal[role="dialog"][data-test-modal]')[0] || modal;
          messageField = getMessageTextarea(modal);
          debugLog('sendInvite: wait messageField intento', i + 1, 'field=', !!messageField);
          if (!messageField) await delay(250);
        }

        if (messageField) {
          await setTextFieldByPaste(messageField, resolvedMessage);
          const writtenValue = getFieldCurrentText(messageField).trim();
          debugLog('message-field-populated', {
            expectedLength: resolvedMessage.length,
            actualLength: writtenValue.length,
            exactMatch: writtenValue === resolvedMessage,
            startsWithExpected: resolvedMessage ? writtenValue.startsWith(resolvedMessage.slice(0, 20)) : false,
          });
          await delay(450);

          const sendWithNoteBtn = getSendWithNoteButton(modal);
          debugLog(
            'sendInvite: sendWithNoteBtn=',
            !!sendWithNoteBtn,
            'disabled=',
            !!sendWithNoteBtn?.disabled,
            'ariaDisabled=',
            sendWithNoteBtn?.getAttribute?.('aria-disabled') || ''
          );
          if (sendWithNoteBtn) {
            sendWithNoteBtn.click();
            const outcome = await waitInviteOutcome(connectButton);
            sentOk = outcome.sentOk;
            linkedinLimitReached = outcome.linkedinLimitReached;
            if (!sentOk && !linkedinLimitReached) {
              failureReason = outcome.reason || 'send_with_note_not_confirmed';
            }
            if (linkedinLimitReached && !limitCause) {
              limitCause = isLinkedInApiLimitReached() ? 'api_429' : 'ui_limit';
            }
          }
        }
      }
    }

    // 3) Fallback: enviar sin nota si lo anterior falla
    if (!sentOk && !linkedinLimitReached) {
      for (let i = 0; i < 12 && !sentOk; i++) {
        const limitDialog = findLinkedInLimitDialog();
        modal = findInviteDialog();
        if (
          limitDialog ||
          (modal && isLinkedInLimitReached(modal)) ||
          isLinkedInApiLimitReached()
        ) {
          linkedinLimitReached = true;
          limitCause = isLinkedInApiLimitReached() ? 'api_429' : 'ui_limit';
          failureReason = limitCause === 'api_429' ? 'linkedin_limit_api_429' : 'linkedin_limit_ui';
          break;
        }
        const sendBtn = modal ? (getSendWithoutNoteButton(modal) || getSendButton(modal)) : null;
        debugLog('sendInvite: fallback intento', i + 1, 'modal=', !!modal, 'sendBtn=', !!sendBtn);
        if (sendBtn) {
          sendBtn.click();
          const outcome = await waitInviteOutcome(connectButton);
          sentOk = outcome.sentOk;
          linkedinLimitReached = outcome.linkedinLimitReached;
          if (!sentOk && !linkedinLimitReached) {
            failureReason = outcome.reason || 'send_without_note_not_confirmed';
          }
          if (linkedinLimitReached && !limitCause) {
            limitCause = isLinkedInApiLimitReached() ? 'api_429' : 'ui_limit';
          }
          break;
        }
        failureReason = 'send_button_not_found';
        await delay(350);
      }
    }
    await delay(600);
    closeModal();
    await delay(500);

    if (sentOk) {
      chrome.runtime.sendMessage({ action: 'sent' });
    }
    if (!sentOk && !linkedinLimitReached && !failureReason) {
      failureReason = 'invite_not_sent';
    }
    return { sentOk, linkedinLimitReached, limitCause, failureReason };
  }

  function getMessageActionButton() {
    const candidates = findAllDeep('button, a[role="button"]');
    for (const node of candidates) {
      if (!isElementVisible(node) || node.disabled) continue;
      if (node.closest('.msg-overlay-bubble-content, .msg-overlay-list-bubble, .msg-form, .msg-overlay-conversation-bubble')) continue;
      const text = (node.textContent || '').trim().toLowerCase();
      const aria = (node.getAttribute('aria-label') || '').trim().toLowerCase();
      if (
        text.includes('mensaje') ||
        text.includes('message') ||
        text.includes('inmail') ||
        aria.includes('mensaje') ||
        aria.includes('message') ||
        aria.includes('inmail')
      ) {
        return node;
      }
    }
    return null;
  }

  function getFieldCurrentText(field) {
    if (!field) return '';
    if (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') return String(field.value || '');
    return String(field.textContent || '');
  }

  function getComposerCloseButton(root) {
    if (!root) return null;
    return (
      root.querySelector('button[aria-label*="close" i]') ||
      root.querySelector('button[aria-label*="cerrar" i]') ||
      root.querySelector('button[aria-label*="dismiss" i]') ||
      root.querySelector('button.msg-overlay-bubble-header__control[aria-label*="close" i]') ||
      root.querySelector('button.msg-overlay-bubble-header__control[aria-label*="cerrar" i]') ||
      null
    );
  }

  function getMessagingOverlayContainers() {
    return findAllDeep(
      '.msg-overlay-bubble-content, .msg-overlay-list-bubble, .msg-overlay-conversation-bubble, .msg-convo-wrapper, .msg-overlay-bubble-header'
    );
  }

  function getGlobalMessagingCloseButtons() {
    const selectors = [
      'button[aria-label*="close conversation" i]',
      'button[aria-label*="cerrar conversacion" i]',
      'button[aria-label*="cerrar conversación" i]',
      'button[aria-label*="close message" i]',
      'button[aria-label*="cerrar mensaje" i]',
      'button[aria-label*="dismiss" i]',
      'button[aria-label*="descartar" i]',
      'button.msg-overlay-bubble-header__control[aria-label*="close" i]',
      'button.msg-overlay-bubble-header__control[aria-label*="cerrar" i]',
      'button.msg-overlay-bubble-header__control[aria-label*="dismiss" i]',
    ];
    const out = [];
    for (const sel of selectors) {
      const nodes = findAllDeep(sel);
      for (const node of nodes) {
        if (!isElementVisible(node) || node.disabled) continue;
        out.push(node);
      }
    }
    return out;
  }

  function hasBlockingMessagingOverlay() {
    const overlays = getMessagingOverlayContainers();
    if (overlays.length > 0) return true;
    return getGlobalMessagingCloseButtons().length > 0;
  }

  async function closeOpenComposerIfAny(maxPasses = 4) {
    for (let i = 0; i < maxPasses; i++) {
      const composer = getComposerRoot();
      const overlays = getMessagingOverlayContainers();
      const closeButtons = getGlobalMessagingCloseButtons();
      if (!composer && overlays.length === 0 && closeButtons.length === 0) return;

      let closedSomething = false;
      const closeBtn = getComposerCloseButton(composer);
      if (closeBtn && isElementVisible(closeBtn)) {
        closeBtn.click();
        closedSomething = true;
      }
      for (const btn of closeButtons) {
        try {
          btn.click();
          closedSomething = true;
        } catch (_) {}
      }

      // Escape múltiple para cerrar drawers/overlays que ignoran el botón directo.
      for (let esc = 0; esc < 2; esc++) {
        const evtDown = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
        const evtUp = new KeyboardEvent('keyup', { key: 'Escape', bubbles: true });
        document.activeElement?.dispatchEvent(evtDown);
        document.activeElement?.dispatchEvent(evtUp);
        document.dispatchEvent(evtDown);
        document.dispatchEvent(evtUp);
        window.dispatchEvent(evtDown);
        window.dispatchEvent(evtUp);
      }
      debugLog('InMail close composer pass', i + 1, {
        composer: !!composer,
        overlays: overlays.length,
        closeButtons: closeButtons.length,
        closedSomething,
      });
      if (!closedSomething && i >= 1) {
        // Evita loops largos cuando LinkedIn mantiene overlays no bloqueantes.
        break;
      }
      await delay(260);
    }
  }

  function getComposerRoot() {
    const dialogs = findAllDeep('.artdeco-modal[role="dialog"], [role="dialog"]');
    for (const dialog of dialogs) {
      if (!isElementVisible(dialog)) continue;
      const text = normalizeText(dialog.textContent || '');
      if (text.includes('mensaje') || text.includes('message') || text.includes('inmail')) {
        return dialog;
      }
    }
    const overlayComposer =
      document.querySelector('.msg-overlay-bubble-header')?.closest('.msg-overlay-bubble-content') ||
      document.querySelector('.msg-form')?.closest('.msg-overlay-bubble-content') ||
      document.querySelector('.msg-form') ||
      document.querySelector('.msg-overlay-bubble-content');
    if (overlayComposer && isElementVisible(overlayComposer)) {
      return overlayComposer;
    }
    return null;
  }

  function composerLooksLikeSentState(root) {
    if (!root) return false;
    const txt = normalizeText(root.textContent || '');
    return (
      txt.includes('mensaje enviado') ||
      txt.includes('message sent') ||
      txt.includes('sent successfully') ||
      txt.includes('se envio tu mensaje')
    );
  }

  function queryDeepInRoot(root, selector) {
    if (!root) return [];
    const out = [];
    try {
      const direct = root.querySelectorAll(selector);
      out.push(...direct);
    } catch (_) {}
    try {
      const deep = findAllDeep(selector, root);
      out.push(...deep);
    } catch (_) {}
    return out.filter(Boolean);
  }

  function firstVisibleDeep(root, selector) {
    const nodes = queryDeepInRoot(root, selector);
    for (const node of nodes) {
      if (isElementVisible(node)) return node;
    }
    return null;
  }

  function getSubjectInput(root) {
    if (!root) return null;
    return (
      firstVisibleDeep(root, 'input[name*="subject" i]') ||
      firstVisibleDeep(root, 'input[id*="subject" i]') ||
      firstVisibleDeep(root, 'input[placeholder*="asunto" i]') ||
      firstVisibleDeep(root, 'input[placeholder*="subject" i]') ||
      firstVisibleDeep(root, 'input[aria-label*="asunto" i]') ||
      firstVisibleDeep(root, 'input[aria-label*="subject" i]') ||
      firstVisibleDeep(root, '[role="textbox"][aria-label*="asunto" i]') ||
      firstVisibleDeep(root, '[role="textbox"][aria-label*="subject" i]') ||
      firstVisibleDeep(root, 'input[title*="asunto" i]') ||
      firstVisibleDeep(root, 'input[title*="subject" i]') ||
      null
    );
  }

  function findAnySubjectInput() {
    const candidates = findAllDeep(
      'input[name*="subject" i], input[id*="subject" i], input[placeholder*="asunto" i], input[placeholder*="subject" i], input[aria-label*="asunto" i], input[aria-label*="subject" i], input[title*="asunto" i], input[title*="subject" i], [role="textbox"][aria-label*="asunto" i], [role="textbox"][aria-label*="subject" i]'
    );
    for (const field of candidates) {
      if (!isElementVisible(field) || field.disabled) continue;
      const inMessagingUi = !!field.closest(
        '.msg-form, .msg-overlay-bubble-content, .msg-overlay-conversation-bubble, .artdeco-modal, [role="dialog"]'
      );
      if (!inMessagingUi) continue;
      return field;
    }
    return null;
  }

  function getSubjectActivationButton(root) {
    if (!root) return null;
    const buttons = queryDeepInRoot(root, 'button, [role="button"]');
    return (
      buttons.find((btn) => {
        if (!isElementVisible(btn) || btn.disabled) return false;
        const text = normalizeText(btn.textContent || '');
        const aria = normalizeText(btn.getAttribute?.('aria-label') || '');
        const title = normalizeText(btn.getAttribute?.('title') || '');
        const combined = `${text} ${aria} ${title}`;
        const hasSubjectWord = combined.includes('asunto') || combined.includes('subject');
        const hasAddWord = combined.includes('anadir') || combined.includes('agregar') || combined.includes('add');
        return hasSubjectWord || (hasSubjectWord && hasAddWord);
      }) || null
    );
  }

  async function ensureSubjectField(composer, maxAttempts = 5) {
    let field = null;
    for (let i = 0; i < maxAttempts; i++) {
      field = getSubjectInput(composer);
      if (field) return field;
      const subjectActivator = getSubjectActivationButton(composer);
      if (subjectActivator) {
        debugLog('InMail subject activation click', i + 1);
        subjectActivator.click();
      }
      await delay(200);
    }
    field = findAnySubjectInput();
    if (field) {
      debugLog('InMail subject field found via global fallback');
      return field;
    }
    return null;
  }

  function getBodyInput(root) {
    if (!root) return null;
    const direct =
      firstVisibleDeep(root, 'textarea[name*="message" i]') ||
      firstVisibleDeep(root, 'textarea') ||
      firstVisibleDeep(root, '[role="textbox"][aria-label*="message" i]') ||
      firstVisibleDeep(root, '[role="textbox"][aria-label*="mensaje" i]') ||
      firstVisibleDeep(root, '.msg-form__contenteditable[contenteditable="true"]') ||
      firstVisibleDeep(root, '.msg-form__contenteditable') ||
      firstVisibleDeep(root, '[contenteditable="true"][role="textbox"]') ||
      firstVisibleDeep(root, '[contenteditable="true"]') ||
      firstVisibleDeep(root, '[role="textbox"]') ||
      null;
    if (direct) return direct;

    // Algunas variantes de UI renderizan el editor dentro de iframes.
    const frames = queryDeepInRoot(root, 'iframe');
    for (const frame of frames) {
      try {
        const doc = frame.contentDocument;
        if (!doc) continue;
        const byIframe =
          doc.querySelector('textarea[name*="message" i]') ||
          doc.querySelector('textarea') ||
          doc.querySelector('[role="textbox"][aria-label*="message" i]') ||
          doc.querySelector('[role="textbox"][aria-label*="mensaje" i]') ||
          doc.querySelector('.msg-form__contenteditable[contenteditable="true"]') ||
          doc.querySelector('.msg-form__contenteditable') ||
          doc.querySelector('[contenteditable="true"][role="textbox"]') ||
          doc.querySelector('[contenteditable="true"]') ||
          doc.querySelector('[role="textbox"]');
        if (byIframe && isElementVisible(byIframe)) return byIframe;
      } catch (_) {}
    }
    return null;
  }

  function findAnyMessagingEditor() {
    const candidates = findAllDeep(
      'textarea, [contenteditable="true"], .msg-form__contenteditable, [role="textbox"]'
    );
    for (const field of candidates) {
      if (!isElementVisible(field) || field.disabled) continue;
      const inMessagingUi = !!field.closest(
        '.msg-form, .msg-overlay-bubble-content, .msg-overlay-conversation-bubble, .artdeco-modal, [role="dialog"]'
      );
      if (!inMessagingUi) continue;
      return field;
    }
    return null;
  }

  function getComposerActivationButton(root) {
    if (!root) return null;
    const buttons = queryDeepInRoot(root, 'button, [role="button"]');
    return (
      buttons.find((btn) => {
        if (!isElementVisible(btn) || btn.disabled) return false;
        const text = normalizeText(btn.textContent || '');
        const aria = normalizeText(btn.getAttribute?.('aria-label') || '');
        const combined = `${text} ${aria}`;
        if (combined.includes('escribir') && combined.includes('mensaje')) return true;
        if (combined.includes('write') && combined.includes('message')) return true;
        if (text === 'siguiente' || text === 'next' || text === 'continuar' || text === 'continue') return true;
        return false;
      }) || null
    );
  }

  async function ensureComposerBodyField(composer, maxAttempts = 8) {
    let field = null;
    for (let i = 0; i < maxAttempts; i++) {
      field = getBodyInput(composer);
      if (field) return field;
      const activation = getComposerActivationButton(composer);
      if (activation) {
        debugLog('InMail composer activation click', i + 1);
        activation.click();
      }
      await delay(220);
    }
    // Fallback global: intenta localizar cualquier editor de mensajería visible
    // antes de rendirse definitivamente con message_field_not_found.
    field = findAnyMessagingEditor();
    if (field) {
      debugLog('InMail body field found via global messaging fallback inside ensureComposerBodyField');
      return field;
    }
    return null;
  }

  function getComposerSendButton(root) {
    if (!root) return null;
    const bySelectors =
      firstVisibleDeep(root, 'button.msg-form__send-btn:not([disabled])') ||
      firstVisibleDeep(root, 'button.msg-form__send-button:not([disabled])') ||
      firstVisibleDeep(root, 'button[type="submit"]:not([disabled])') ||
      firstVisibleDeep(root, 'button.artdeco-button--primary:not([disabled])') ||
      firstVisibleDeep(root, 'button[data-control-name*="send" i]:not([disabled])') ||
      firstVisibleDeep(root, 'button[aria-label*="send" i]:not([disabled])') ||
      firstVisibleDeep(root, 'button[aria-label*="enviar" i]:not([disabled])') ||
      firstVisibleDeep(root, '[role="button"][aria-label*="send" i]:not([aria-disabled="true"])') ||
      firstVisibleDeep(root, '[role="button"][aria-label*="enviar" i]:not([aria-disabled="true"])') ||
      firstVisibleDeep(root, '[role="button"][title*="send" i]:not([aria-disabled="true"])') ||
      firstVisibleDeep(root, '[role="button"][title*="enviar" i]:not([aria-disabled="true"])');
    if (bySelectors && isElementVisible(bySelectors)) return bySelectors;
    const buttons = root.querySelectorAll('button, [role="button"]');
    return (
      [...buttons].find((btn) => {
        const ariaDisabled = String(btn.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true';
        if (!isElementVisible(btn) || btn.disabled || ariaDisabled) return false;
        const text = normalizeText(btn.textContent || '');
        const aria = normalizeText(btn.getAttribute('aria-label') || '');
        const title = normalizeText(btn.getAttribute('title') || '');
        return (
          text.includes('enviar') ||
          text.includes('send') ||
          text.includes('inmail') ||
          aria.includes('enviar') ||
          aria.includes('send') ||
          aria.includes('inmail') ||
          title.includes('enviar') ||
          title.includes('send')
        );
      }) || null
    );
  }

  function findAnyMessagingSendButton() {
    const buttons = findAllDeep('button, [role="button"], a[role="button"]');
    for (const btn of buttons) {
      const ariaDisabled = String(btn.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true';
      if (!isElementVisible(btn) || btn.disabled || ariaDisabled) continue;
      const inMessagingUi = !!btn.closest(
        '.msg-form, .msg-overlay-bubble-content, .msg-overlay-conversation-bubble, .artdeco-modal, [role="dialog"]'
      );
      if (!inMessagingUi) continue;
      const text = normalizeText(btn.textContent || '');
      const aria = normalizeText(btn.getAttribute?.('aria-label') || '');
      const title = normalizeText(btn.getAttribute?.('title') || '');
      const combined = `${text} ${aria} ${title}`;
      if (combined.includes('close') || combined.includes('cerrar') || combined.includes('dismiss') || combined.includes('descartar')) continue;
      if (combined.includes('enviar') || combined.includes('send') || combined.includes('inmail')) {
        return btn;
      }
    }
    return null;
  }

  async function tryKeyboardSendFallback(composer) {
    const field = getBodyInput(composer) || findAnyMessagingEditor();
    if (!field) return false;
    field.focus();
    await delay(120);
    const combos = [
      { key: 'Enter', ctrlKey: true },
      { key: 'Enter', metaKey: true },
      { key: 'Enter' },
    ];
    for (const combo of combos) {
      try {
        const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...combo });
        const up = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...combo });
        field.dispatchEvent(down);
        field.dispatchEvent(up);
        document.dispatchEvent(down);
        document.dispatchEvent(up);
      } catch (_) {}
      await delay(260);
      const currentComposer = getComposerRoot();
      const bodyAfter = getFieldCurrentText(getBodyInput(currentComposer) || field).trim();
      const sendAfter = getComposerSendButton(currentComposer);
      const hasUiSignal = hasInmailUiConfirmationSignal(currentComposer || document);
      if (hasUiSignal || !bodyAfter || (sendAfter && sendAfter.disabled)) {
        return true;
      }
    }
    return false;
  }

  function dispatchFieldInputEvents(field, textData) {
    try {
      field.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: textData,
      }));
    } catch (_) {}
    try {
      field.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: false, inputType: 'insertFromPaste', data: textData,
      }));
    } catch (_) {
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setNativeInputValue(field, value) {
    const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(field, value);
    } else {
      field.value = value;
    }
  }

  async function setTextFieldByPaste(field, value) {
    const safe = String(value || '');
    const isInput = field.tagName === 'TEXTAREA' || field.tagName === 'INPUT';
    const isEditable = !isInput && field.getAttribute('contenteditable') === 'true';

    field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    field.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    field.focus();
    await delay(80);

    if (isInput) {
      try { field.select(); } catch (_) {}
      await delay(30);
      let ok = false;
      try { ok = document.execCommand('insertText', false, safe); } catch (_) {}
      if (!ok || field.value !== safe) {
        setNativeInputValue(field, safe);
      }
      dispatchFieldInputEvents(field, safe);
      await delay(60);
      return;
    }

    if (isEditable) {
      field.focus();
      await delay(40);
      document.execCommand('selectAll', false, null);
      await delay(30);

      let inserted = false;
      try { inserted = document.execCommand('insertText', false, safe); } catch (_) {}
      await delay(40);

      let current = getFieldCurrentText(field).trim();
      if (inserted && current === safe.trim()) {
        dispatchFieldInputEvents(field, safe);
        await delay(60);
        return;
      }

      field.focus();
      await delay(30);
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await delay(30);
      try { inserted = document.execCommand('insertText', false, safe); } catch (_) { inserted = false; }
      await delay(40);
      current = getFieldCurrentText(field).trim();
      if (current === safe.trim()) {
        dispatchFieldInputEvents(field, safe);
        await delay(60);
        return;
      }

      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', safe);
        field.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        await delay(80);
        current = getFieldCurrentText(field).trim();
        if (current === safe.trim()) {
          await delay(60);
          return;
        }
      } catch (_) {}

      field.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = safe;
      field.appendChild(p);
      dispatchFieldInputEvents(field, safe);
      await delay(60);
      return;
    }

    let ok = false;
    try { ok = document.execCommand('insertText', false, safe); } catch (_) {}
    if (!ok) {
      if ('value' in field) { setNativeInputValue(field, safe); }
      else { field.textContent = safe; }
    }
    dispatchFieldInputEvents(field, safe);
    await delay(60);
  }

  function getFirstNameFromFullName(fullName) {
    const parts = String(fullName || '')
      .trim()
      .split(/\s+/)
      .filter((p) => p && !/^\d+$/.test(p));
    if (!parts.length) return '';
    return parts[0];
  }

  function getFirstNameFromProfileUrl(profileUrl) {
    const raw = String(profileUrl || '').trim();
    if (!raw) return '';
    let slug = '';
    try {
      const parsed = new URL(raw);
      const pieces = parsed.pathname.split('/').filter(Boolean);
      const inIdx = pieces.findIndex((part) => normalizeText(part) === 'in');
      slug = inIdx >= 0 ? pieces[inIdx + 1] || '' : pieces[pieces.length - 1] || '';
    } catch (_) {
      const match = raw.match(/\/in\/([^/?#]+)/i);
      slug = match?.[1] || '';
    }
    if (!slug) return '';
    // Si el slug contiene dígitos asumimos que es un username técnico (juanperez123, ana_sales2024, etc.)
    // y preferimos no usarlo como nombre para {{name}}.
    if (/[0-9]/.test(slug)) return '';
    let decoded = slug;
    try {
      decoded = decodeURIComponent(decoded);
    } catch (_) {}
    const normalizedSlug = decoded
      .replace(/\d+/g, ' ')
      .replace(/[-_.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalizedSlug) return '';
    const parts = normalizedSlug.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return sanitizeFirstName(parts[0]) || '';
    }
    const single = sanitizeFirstName(parts[0] || '');
    // Slugs de una sola palabra y muy largos suelen ser username concatenado,
    // no nombre real ("nataliacuadradoperez", "cristinaginesvelasco").
    if (single && single.length <= 11) return single;
    return '';
  }

  const BAD_NAME_WORDS = new Set([
    'estado', 'status', 'pendiente', 'pending', 'mensaje', 'message', 'conectar', 'connect',
    'seguir', 'follow', 'enviar', 'send', 'invitacion', 'invitation', 'perfil', 'profile',
    'invita', 'invitar', 'invite', 'invited', 'dismiss', 'cerrar', 'close', 'cancel',
    'cancelar', 'aceptar', 'accept', 'rechazar', 'reject', 'retirar', 'withdraw',
  ]);

  function capitalizeNameToken(raw) {
    const token = String(raw || '').trim();
    if (!token) return '';
    if (token !== token.toLowerCase()) return token;
    return token
      .split(/([-'])/)
      .map((part, idx) => {
        if (idx % 2 === 1) return part;
        if (!part) return part;
        return part.charAt(0).toLocaleUpperCase() + part.slice(1);
      })
      .join('');
  }

  function sanitizeFirstName(raw) {
    const cleaned = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    const first = cleaned.split(' ')[0].replace(/[^\p{L}\-']/gu, '').trim();
    if (!first || first.length < 2) return '';
    if (/^\d+$/.test(first)) return '';
    if (BAD_NAME_WORDS.has(first.toLowerCase())) return '';
    return capitalizeNameToken(first);
  }

  function sanitizeDisplayName(raw) {
    const compact = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    const withoutDegree = compact
      .replace(/^\s*(ver perfil de|see profile of)\s+/i, '')
      .replace(/\s*[·•]\s*\d+(?:st|nd|rd|th|º|°)?\+?\s*$/i, '')
      .trim();
    if (!withoutDegree) return '';
    const normalized = withoutDegree.toLowerCase();
    if (BAD_NAME_WORDS.has(normalized)) return '';
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length > 0 && words.every((w) => BAD_NAME_WORDS.has(w))) return '';
    return withoutDegree;
  }

  function normalizeTemplateName(raw) {
    const text = String(raw || '')
      .replace(/\{\{name\}\}/gi, '')
      .replace(/\{\{first_name\}\}/gi, '')
      .trim();
    if (!text) return '';
    return sanitizeFirstName(getFirstNameFromFullName(text)) || '';
  }

  function extractNameFromConnectAction(connectButton) {
    if (!connectButton) return '';
    const rawCandidates = [
      connectButton.getAttribute('aria-label') || '',
      connectButton.getAttribute('title') || '',
    ]
      .map((v) => String(v || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const cleanupCapturedName = (value) => {
      const cleaned = String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s:;,\-]+/, '')
        .replace(/[\s:;,\-]+$/, '')
        .trim();
      return sanitizeDisplayName(cleaned);
    };
    const patterns = [
      /invitar?\s+a\s+(.+?)\s+a\s+conectar/i,
      /invitar?\s+a\s+(.+?)\s+para\s+conectar/i,
      /invitar?\s+a\s+(.+?)\s+a\s+tu\s+red/i,
      /inviter?\s+(.+?)\s+[aà]\s+se\s+connecter/i,
      /invite\s+(.+?)\s+to\s+connect/i,
      /invite\s+(.+?)\s+to\s+your\s+network/i,
      /connect\s+with\s+(.+?)$/i,
      /conectar?\s+con\s+(.+?)$/i,
    ];
    for (const raw of rawCandidates) {
      for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (!match?.[1]) continue;
        const extracted = cleanupCapturedName(match[1]);
        if (extracted) {
          debugLog('extractNameFromConnectAction matched', { pattern: pattern.source, extracted, raw });
          return extracted;
        }
      }
      const normalized = normalizeText(raw);
      const normalizedPatterns = [
        /invitar? a (.+?) a conectar/,
        /invitar? a (.+?) para conectar/,
        /invitar? a (.+?) a tu red/,
        /invite (.+?) to connect/,
        /invite (.+?) to your network/,
        /connect with (.+?)$/,
        /conectar? con (.+?)$/,
      ];
      for (const pattern of normalizedPatterns) {
        const match = normalized.match(pattern);
        if (!match?.[1]) continue;
        const extracted = cleanupCapturedName(match[1]);
        if (extracted) {
          debugLog('extractNameFromConnectAction matched (normalized)', { pattern: pattern.source, extracted });
          return extracted;
        }
      }
    }
    return '';
  }

  function applyNameTemplate(template, rawName) {
    const baseTemplate = String(template || '');
    if (!baseTemplate) return '';
    const safeName = normalizeTemplateName(rawName || '');
    const tokenRegex = /\{\{\s*name\s*\}\}/gi;
    if (!safeName) {
      return baseTemplate
        .replace(tokenRegex, '')
        .replace(/\s+([,;.!?:])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    return baseTemplate.replace(tokenRegex, safeName);
  }

  function resolveNameWithSource(connectButton, profile, fallbackFullName = '') {
    const candidates = [
      { source: 'profile.firstToken', value: sanitizeFirstName(getFirstNameFromFullName(profile?.fullName || '')) },
      { source: 'fallback.firstToken', value: sanitizeFirstName(getFirstNameFromFullName(fallbackFullName || '')) },
      { source: 'connect.aria_extract', value: sanitizeFirstName(getFirstNameFromFullName(extractNameFromConnectAction(connectButton))) },
      { source: 'card.title_firstToken', value: sanitizeFirstName(getFirstNameFromFullName(getProfileNameForButton(connectButton))) },
    ];
    const chosen = candidates.find((candidate) => candidate.value);
    debugLog('name-resolution-candidates', {
      chosen: chosen?.source || 'none',
      chosenValue: chosen?.value || '',
      profileFullName: profile?.fullName || '',
      fallbackFullName: fallbackFullName || '',
      all: candidates.map((c) => ({ source: c.source, value: c.value || '' })),
    });
    return {
      name: chosen?.value || '',
      source: chosen?.source || 'none',
      candidates,
    };
  }

  function resolveFirstName(connectButton, profile, fallbackFullName = '') {
    return resolveNameWithSource(connectButton, profile, fallbackFullName).name;
  }

  function getProfileConnectButton() {
    const candidates = findAllDeep('button, a[role="button"], a');
    for (const node of candidates) {
      if (!isElementVisible(node) || node.disabled) continue;
      if (!buttonIsConnect(node)) continue;
      const card = getCardFromActionButton(node);
      // En perfil individual preferimos botones fuera de tarjetas de búsqueda.
      if (card && card.closest('.reusable-search__entity-result-list')) continue;
      return node;
    }
    return null;
  }

  function getProfileFirstName() {
    const heading =
      document.querySelector('h1') ||
      document.querySelector('.pv-top-card h1') ||
      document.querySelector('[data-section="top-card"] h1');
    const text = (heading?.textContent || '').trim();
    return text ? sanitizeDisplayName(text) || getFirstNameFromFullName(text) : '';
  }

  async function processConnectOnCurrentProfile(payload) {
    const profileReady = await waitForProfileReady(payload?.profileUrl || '', 90000);
    if (!profileReady.ok) {
      return { status: 'RETRY', reason: profileReady.reason || 'profile_not_ready' };
    }
    await delay(700);
    const connectButton = getProfileConnectButton();
    if (!connectButton) {
      return { status: 'SKIPPED', reason: 'connect_not_available' };
    }
    const firstName = getProfileFirstName();
    debugLog('name-resolution-profile-page', {
      chosenName: firstName || '',
      source: firstName ? 'profile.h1' : 'none',
      profileUrl: payload?.profileUrl || window.location.href || '',
    });
    const result = await sendInvite(connectButton, firstName);
    if (result?.linkedinLimitReached) {
      return { status: 'STOPPED', reason: result.limitCause === 'api_429' ? 'linkedin_limit_reached_429' : 'linkedin_limit_reached' };
    }
    if (result?.sentOk) {
      return { status: 'SENT', reason: '' };
    }
    return { status: 'FAILED', reason: result?.failureReason || 'invite_not_sent' };
  }

  async function processInmailOnCurrentProfile(subject, payload) {
    const href = window.location.href || '';
    if (href.includes('/search/results/')) {
      debugLog('InMail skip: search results page not supported', href);
      return { status: 'SKIPPED', reason: 'inmail_not_supported_on_search_results' };
    }
    const textMessage = payload?.text || '';
    const firstName = normalizeTemplateName(payload?.fullName || '') || normalizeTemplateName(getProfileFirstName() || '');
    debugLog('InMail start', {
      profileUrl: payload?.profileUrl || '',
      fullName: payload?.fullName || '',
      hasSubject: !!String(subject || '').trim(),
      messageLength: String(textMessage || '').length,
    });
    const profileReady = await waitForProfileReady(payload?.profileUrl || '', 30000);
    if (!profileReady.ok) {
      debugLog('InMail profile not ready', profileReady.reason || 'profile_not_ready');
      return { status: 'RETRY', reason: profileReady.reason || 'profile_not_ready' };
    }
    await refreshLinkedInApiLimitState();
    if (findLinkedInLimitDialog() || isLinkedInApiLimitReached()) {
      return { status: 'FAILED', reason: getLinkedinLimitReason() };
    }
    debugLog('InMail profile ready');
    // Si LinkedIn dejó abierto un composer del perfil anterior, cerrarlo
    // antes de buscar el botón "Enviar mensaje" del perfil actual.
    await closeOpenComposerIfAny(4);
    await delay(900);
    let messageButton = getMessageActionButton();
    // Solo intentamos segunda pasada si realmente no encontramos botón de mensaje.
    if (!messageButton && hasBlockingMessagingOverlay()) {
      debugLog('InMail blocking overlay detected with missing message button, running second close pass');
      await closeOpenComposerIfAny(3);
      await delay(700);
      messageButton = getMessageActionButton();
    }
    if (!messageButton) {
      debugLog('InMail message button not found');
      if (findLinkedInLimitDialog() || isLinkedInApiLimitReached()) {
        return { status: 'FAILED', reason: getLinkedinLimitReason() };
      }
      if (hasBlockingMessagingOverlay()) {
        return { status: 'RETRY', reason: 'blocking_overlay_active' };
      }
      return { status: 'SKIPPED', reason: 'message_button_not_found' };
    }
    debugLog('InMail message button found');
    let composer = null;
    let bodyField = null;
    for (let openAttempt = 0; openAttempt < 3; openAttempt++) {
      debugLog('InMail open composer attempt', openAttempt + 1);
      messageButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(250);
      messageButton.click();

      composer = null;
      for (let i = 0; i < 16 && !composer; i++) {
        composer = getComposerRoot();
        if (!composer) await delay(250);
      }
      if (!composer) continue;

      bodyField = await ensureComposerBodyField(composer, 12);
      const hasBodyField = !!bodyField;
      if (composerLooksLikeSentState(composer) && !hasBodyField) {
        debugLog('InMail composer in sent state, retrying open');
        await closeOpenComposerIfAny(3);
        await delay(300);
        continue;
      }
      if (!hasBodyField) {
        debugLog('InMail composer without body field, retrying open');
        await closeOpenComposerIfAny(3);
        await delay(300);
        continue;
      }
      debugLog('InMail composer ready', { hasBodyField });
      break;
    }
    if (!composer) {
      debugLog('InMail composer not found after retries');
      if (findLinkedInLimitDialog() || isLinkedInApiLimitReached()) {
        return { status: 'FAILED', reason: getLinkedinLimitReason() };
      }
      return { status: 'FAILED', reason: 'composer_not_found' };
    }

    const subjectField = await ensureSubjectField(composer, 5);
    if (subjectField && String(subject || '').trim()) {
      debugLog('InMail subject field found, pasting subject');
      await setTextFieldByPaste(subjectField, subject);
      await delay(150);
    } else {
      debugLog('InMail subject field not found or empty subject, continuing');
    }

    bodyField = await ensureComposerBodyField(composer, 14);
    if (!bodyField) {
      // Fallback final: buscar un editor visible en UI de mensajería aunque
      // no quede anidado en el composer elegido.
      bodyField = findAnyMessagingEditor();
      if (bodyField) {
        debugLog('InMail body field found via global messaging fallback');
        const bodyRoot =
          bodyField.closest('.msg-form, .msg-overlay-bubble-content, .msg-overlay-conversation-bubble, .artdeco-modal, [role="dialog"]') ||
          null;
        if (bodyRoot) composer = bodyRoot;
      }
    }
    if (!bodyField) {
      debugLog('InMail body field not found');
      return { status: 'FAILED', reason: 'message_field_not_found' };
    }
    const finalMessage = applyNameTemplate(textMessage, firstName);
    debugLog('InMail pasting body', { length: finalMessage.length });
    await setTextFieldByPaste(bodyField, finalMessage);
    await delay(450);

    let sendBtn = null;
    for (let i = 0; i < 24; i++) {
      composer = getComposerRoot() || composer;
      sendBtn = getComposerSendButton(composer);
      if (!sendBtn) {
        const nearBodyRoot =
          bodyField?.closest?.('.msg-form, .msg-overlay-bubble-content, .msg-overlay-conversation-bubble, .artdeco-modal, [role="dialog"]') ||
          null;
        if (nearBodyRoot) {
          sendBtn = getComposerSendButton(nearBodyRoot);
          if (sendBtn) debugLog('InMail send button found near body field root');
        }
      }
      if (!sendBtn) {
        sendBtn = findAnyMessagingSendButton();
        if (sendBtn) debugLog('InMail send button found via global messaging fallback');
      }
      if (sendBtn) break;
      await delay(300);
    }
    if (!sendBtn) {
      debugLog('InMail send button not found, trying keyboard fallback');
      const keyboardSent = await tryKeyboardSendFallback(composer);
      if (keyboardSent) {
        debugLog('InMail sent confirmed via keyboard fallback');
        return { status: 'SENT', reason: '' };
      }
      return { status: 'FAILED', reason: 'composer_send_not_found' };
    }
    const bodyBeforeSend = getFieldCurrentText(getBodyInput(composer)).trim();
    debugLog('InMail clicking send', { bodyBeforeSendLength: bodyBeforeSend.length });
    sendBtn.click();
    await delay(350);

    // Algunos flujos de InMail muestran primero "Siguiente" y luego "Enviar".
    const maybeNextComposer = getComposerRoot();
    if (maybeNextComposer) {
      const secondSend = getComposerSendButton(maybeNextComposer);
      if (secondSend && secondSend !== sendBtn) {
        debugLog('InMail second step send detected, clicking');
        secondSend.click();
      }
    }

    let inmailSignalSeen = hasInmailUiConfirmationSignal(composer);
    for (let i = 0; i < 20; i++) {
      await delay(250);
      await refreshLinkedInApiLimitState();
      if (findLinkedInLimitDialog() || isLinkedInApiLimitReached()) {
        return { status: 'FAILED', reason: getLinkedinLimitReason() };
      }
      const currentComposer = getComposerRoot();
      const stillOpen = !!currentComposer;
      const hasUiSignal = hasInmailUiConfirmationSignal(currentComposer || document);
      if (hasUiSignal) inmailSignalSeen = true;
      if (!stillOpen) {
        if (inmailSignalSeen) {
          debugLog('InMail sent confirmed: composer closed with confirmation signal');
          return { status: 'SENT', reason: '' };
        }
        continue;
      }
      const bodyAfterSend = getFieldCurrentText(getBodyInput(currentComposer)).trim();
      const sendAfter = getComposerSendButton(currentComposer);
      if (hasUiSignal) {
        debugLog('InMail sent confirmed: feedback signal');
        return { status: 'SENT', reason: '' };
      }
      // En overlays de LinkedIn el composer puede quedar abierto; si el texto
      // quedó vacío o el botón de enviar quedó deshabilitado, tomamos el envío como exitoso.
      if (bodyBeforeSend && !bodyAfterSend) {
        debugLog('InMail sent confirmed: body cleared after send');
        return { status: 'SENT', reason: '' };
      }
      if (sendAfter && sendAfter.disabled) {
        debugLog('InMail sent confirmed: send button disabled');
        return { status: 'SENT', reason: '' };
      }
    }
    debugLog('InMail send not confirmed before timeout');
    return { status: 'FAILED', reason: 'send_not_confirmed' };
  }

  async function waitForProfileReady(targetProfileUrl, timeoutMs = 30000) {
    const start = Date.now();
    let seenProfileSignals = 0;
    while (Date.now() - start < timeoutMs) {
      const href = window.location.href || '';
      const onLinkedinProfile = href.includes('linkedin.com/in/');
      const readyStateOk = document.readyState === 'complete';
      const hasTopCard =
        !!document.querySelector('.pv-top-card') ||
        !!document.querySelector('[data-section="top-card"]') ||
        !!document.querySelector('h1');
      const hasActionArea =
        !!getMessageActionButton() ||
        !!document.querySelector('button[aria-label*="message" i], button[aria-label*="mensaje" i]');

      if (onLinkedinProfile && readyStateOk && (hasTopCard || hasActionArea)) {
        seenProfileSignals++;
        if (seenProfileSignals >= 2) {
          await delay(600);
          return { ok: true };
        }
      } else {
        seenProfileSignals = 0;
      }

      // Si apuntamos a un perfil específico y todavía no llegamos a su URL canónica, seguir esperando.
      if (targetProfileUrl && onLinkedinProfile) {
        const normalizedCurrent = href.replace(/\/+$/, '').toLowerCase();
        const normalizedTarget = String(targetProfileUrl).replace(/\/+$/, '').toLowerCase();
        if (!normalizedCurrent.startsWith(normalizedTarget)) {
          await delay(600);
          continue;
        }
      }
      await delay(600);
    }
    return { ok: false, reason: 'profile_not_ready_timeout' };
  }

  async function runLoop() {
    setupLinkedInQuotaDetector();
    let sentThisSession = 0;
    const limit = config.limit > 0 ? config.limit : Infinity;
    let finishReason = 'unknown';
    let finishDetail = '';
    let noProgressAttempts = 0;
    debugLog('runLoop started', 'url=', window.location.href);
    await emitDiag('start', 'content_runLoop', 'started', { action: 'start' });

    while (running) {
      await refreshLinkedInApiLimitState();
      await dismissWarningDialogIfPresent();
      if (findLinkedInLimitDialog() || isLinkedInApiLimitReached()) {
        finishReason = isLinkedInApiLimitReached() ? 'linkedin_limit_reached_429' : 'linkedin_limit_reached';
        finishDetail = 'linkedin_limit_detected_in_content_loop';
        break;
      }
      let connectButtons = getConnectButtons();
      let followButtons = getFollowButtons();
      debugLog('connectButtons:', connectButtons.length, 'followButtons:', followButtons.length);

      // Espera activa para evitar "saltear" páginas mientras LinkedIn termina de renderizar resultados.
      if (connectButtons.length === 0 && followButtons.length === 0) {
        const waitPasses = 12;
        for (let i = 0; i < waitPasses && running; i++) {
          await delay(500);
          connectButtons = getConnectButtons();
          followButtons = getFollowButtons();
          debugLog('wait current page intento', i + 1, 'connect=', connectButtons.length, 'follow=', followButtons.length);
          if (connectButtons.length > 0 || followButtons.length > 0) break;
          if (i >= 7 && !hasSearchLoadingIndicators()) break;
        }
        await emitDiag('retry', 'runLoop_wait_current_page', 'waiting_results_render', { attempt: 1, maxAttempts: waitPasses });
      }

      if (connectButtons.length === 0) {
        if (followButtons.length > 0) {
          const btn = followButtons[0];
          const card = btn.closest('.entity-result') || btn.closest('li') || btn.parentElement;
          const profile = getProfileInfoFromButton(btn);
          const searchContext = getSearchContext();
          if (profile.url && card) {
            chrome.runtime.sendMessage({
              action: 'addToFollowList',
              profile_url: profile.url,
              full_name: profile.fullName || profile.name || '',
              headline: profile.headline || '',
              location: profile.location || '',
              query: searchContext.query,
              page: searchContext.page,
              status: 'follow_detected',
            });
          }
          if (card) card.setAttribute(PROCESSED_ATTR, '1');
          await delay(300);
        }
        if (running && await goToNextResultsPage()) {
          continue;
        }
        finishReason = 'no_more_results';
        finishDetail = 'no_connect_buttons_and_no_next_page';
        break;
      }

      if (sentThisSession >= limit) {
        finishReason = 'limit_reached';
        finishDetail = `session_limit_reached_at_${sentThisSession}`;
        break;
      }

      const canSend = await sendRuntimeMessage({
        action: 'canSendInvite',
        hourLimit: config.hourLimit,
        dayLimit: config.dayLimit,
      });
      if (canSend?.allowed === false) {
        finishReason = canSend.reason === 'hour_limit_reached' ? 'hour_limit_reached' : 'day_limit_reached';
        finishDetail = `rate_limit:${canSend.reason || 'unknown'}`;
        break;
      }

      const button = connectButtons[0];
      try {
        const profile = getProfileInfoFromButton(button);
        const nameResolution = resolveNameWithSource(button, profile);
        const firstName = nameResolution.name;
        debugLog('name-resolution-connect-loop', {
          chosenName: firstName || '',
          source: nameResolution.source,
          profileUrl: profile?.url || '',
          profileFullName: profile?.fullName || '',
          candidates: nameResolution.candidates,
        });
        const result = await sendInvite(button, firstName);
        if (result?.linkedinLimitReached) {
          finishReason = result?.limitCause === 'api_429' ? 'linkedin_limit_reached_429' : 'linkedin_limit_reached';
          finishDetail = result?.failureReason || '';
          break;
        }
        if (result?.sentOk) {
          sentThisSession++;
          noProgressAttempts = 0;
        } else {
          noProgressAttempts++;
          button.setAttribute(CONNECT_PROCESSED_ATTR, '1');
          finishDetail = result?.failureReason || finishDetail;
          chrome.runtime.sendMessage({
            action: 'inviteFailed',
            profile_url: profile?.url || '',
            full_name: profile?.fullName || '',
            headline: profile?.headline || '',
            location: profile?.location || '',
            reason: result?.failureReason || 'invite_not_sent',
          });
        }
      } catch (e) {
        console.warn('Connect-In:', e);
        closeModal();
        noProgressAttempts++;
        finishDetail = 'unexpected_error';
        await emitDiag('retry', 'runLoop_sendInvite', 'unexpected_error', { attempt: noProgressAttempts });
      }

      if (
        noProgressAttempts >= 3 &&
        (findLinkedInLimitDialog() || isLinkedInApiLimitReached())
      ) {
        finishReason = isLinkedInApiLimitReached() ? 'linkedin_limit_reached_429' : 'linkedin_limit_reached';
        break;
      }

      await delay(randomBetween(config.delayMin * 1000, config.delayMax * 1000));
    }

    if (finishReason === 'unknown') {
      finishReason = running ? 'finished' : 'stopped_by_user';
    }
    if (!finishDetail) {
      finishDetail = running ? 'finished_without_explicit_detail' : 'stopped_flag_cleared_in_content';
    }
    running = false;
    chrome.runtime.sendMessage({
      action: 'finished',
      finishReason,
      reason: finishReason,
      detail: finishDetail,
      sentThisSession,
      limit: Number.isFinite(limit) ? limit : 0,
      runId: currentRunId,
    });
  }

  function normalizeMessageHandlerErrorReason(err, fallback) {
    const raw = String(err?.message || '').trim().toLowerCase();
    if (!raw) return fallback;
    if (/^[a-z0-9_]+$/.test(raw)) return raw;
    if (raw.includes('message channel closed') || raw.includes('the message port closed before a response was received')) {
      return 'message_channel_closed';
    }
    if (raw.includes('profile_not_ready')) return 'profile_not_ready_retry';
    if (raw.includes('timeout')) return 'tab_message_timeout';
    return fallback;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.action !== 'string') {
      sendResponse({ ok: false, reason: 'invalid_message' });
      return;
    }
    if (message.action === 'ping') {
      sendResponse({ ok: true, readyState: document.readyState });
      return;
    }
    if (message.action === 'start') {
      if (running) {
        sendResponse({ ok: true });
        return;
      }
      config = {
        customMessage: message.customMessage || '',
        limit: message.limit || 0,
        delayMin: message.delayMin ?? 5,
        delayMax: message.delayMax ?? 10,
        hourLimit: message.hourLimit || 0,
        dayLimit: message.dayLimit || 0,
        debugMode: !!message.debugMode,
      };
      DEBUG = config.debugMode;
      if (config.delayMax < config.delayMin) config.delayMax = config.delayMin;
      linkedinApiLimitReached = false;
      currentRunId = String(message.runId || '');
      running = true;
      runLoop();
      sendResponse({ ok: true });
      return;
    }
    if (message.action === 'stop') {
      running = false;
      emitDiag('stop', 'content_stop', 'stopped_by_user', { action: 'stop' });
      sendResponse({ ok: true });
      return;
    }
    if (message.action === 'linkedinQuota429') {
      linkedinApiLimitReached = true;
      debugLog('LinkedIn API quota detectada (429) via background');
      sendResponse({ ok: true });
      return;
    }
    if (message.action === 'processInmailProfile') {
      DEBUG = !!message.debugMode;
      currentRunId = String(message.runId || currentRunId || '');
      processInmailOnCurrentProfile(message.subject || '', {
        text: message.message || '',
        profileUrl: message.profileUrl || '',
        fullName: message.fullName || '',
      })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ status: 'FAILED', reason: normalizeMessageHandlerErrorReason(err, 'inmail_unexpected_error') }));
      return true;
    }
    if (message.action === 'processConnectProfile') {
      DEBUG = !!message.debugMode;
      currentRunId = String(message.runId || currentRunId || '');
      if (typeof message.customMessage === 'string') {
        config.customMessage = message.customMessage.trim();
      }
      processConnectOnCurrentProfile({
        profileUrl: message.profileUrl || '',
      })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ status: 'FAILED', reason: normalizeMessageHandlerErrorReason(err, 'connect_unexpected_error') }));
      return true;
    }
    if (message.action === 'processFollowProfile') {
      DEBUG = !!message.debugMode;
      (async () => {
        await refreshLinkedInApiLimitState();
        if (isLinkedInApiLimitReached() || findLinkedInLimitDialog()) {
          sendResponse({ status: 'FAILED', reason: getLinkedinLimitReason() });
          return;
        }
        const connectButtons = getConnectButtons();
        if (!connectButtons.length) {
          sendResponse({ status: 'SKIPPED', reason: 'connect_not_available' });
          return;
        }
        const first = connectButtons[0];
        const profile = getProfileInfoFromButton(first);
        const nameResolution = resolveNameWithSource(first, profile, message.fullName || '');
        const firstName = nameResolution.name;
        debugLog('name-resolution-follow-retry', {
          chosenName: firstName || '',
          source: nameResolution.source,
          profileUrl: profile?.url || '',
          profileFullName: profile?.fullName || '',
          fallbackFullName: message.fullName || '',
          candidates: nameResolution.candidates,
        });
        const canSend = await sendRuntimeMessage({
          action: 'canSendInvite',
          hourLimit: config.hourLimit,
          dayLimit: config.dayLimit,
        });
        if (canSend?.allowed === false) {
          sendResponse({ status: 'FAILED', reason: canSend.reason || 'rate_limit_reached' });
          return;
        }
        const result = await sendInvite(first, firstName);
        if (result?.linkedinLimitReached) {
          sendResponse({ status: 'FAILED', reason: result.limitCause === 'api_429' ? 'linkedin_limit_reached_429' : 'linkedin_limit_reached' });
          return;
        }
        if (result?.sentOk) {
          sendResponse({ status: 'SENT', reason: '' });
          return;
        }
        sendResponse({ status: 'FAILED', reason: result?.failureReason || 'invite_not_sent' });
      })().catch((err) => sendResponse({ status: 'FAILED', reason: normalizeMessageHandlerErrorReason(err, 'follow_retry_unexpected_error') }));
      return true;
    }
    sendResponse({ ok: false, reason: 'unknown_action' });
  });
})();
