/**
 * AnimeWatch IT — Core Application Logic (Vanilla ES6+)
 * Sicurezza: Zero innerHTML. Tutte le viste usano createElement, textContent e DocumentFragment.
 */

'use strict';

(function () {
  const CFG = window.APP_CONFIG;

  // Token OAuth2 mantenuto ESCLUSIVAMENTE in RAM (sessione corrente)
  let memoryAccessToken = null;
  let gisTokenClient = null;

  // Chiavi localStorage
  const STORAGE_KEYS = Object.freeze({
    SETTINGS: 'aw_settings_v1',
    SUBSCRIPTIONS: 'aw_subscriptions_snapshot_v1',
    WATCHLIST: 'aw_watchlist_v1',
    DUB_STATUS: 'aw_ita_dub_map_v1',
    DETAILS_CACHE: 'aw_tmdb_details_cache_v1',
    PRIVACY_SHIELD: 'aw_privacy_shield_v1'
  });

  // Stato globale in memoria
  const state = {
    settings: {
      tmdbKey: '',
      sheetId: '',
      sheetRange: 'A1:C50',
      region: CFG.DEFAULT_REGION,
      googleClientId: CFG.GOOGLE_OAUTH_CLIENT_ID || '',
      googleApiKey: '',
      weeklyHours: CFG.DEFAULT_WEEKLY_HOURS
    },
    // Privacy Shield (anti-spionaggio su telefono sbloccato)
    privacy: {
      hasPin: false,
      pinHash: '',
      isLocked: false,
      pinBuffer: ''
    },
    // Mappa abbonamenti: { [providerKey]: { active: boolean, cost: number } }
    subscriptions: {},
    unrecognizedSheetRows: [],
    lastSheetSync: null,

    // Filtri Esplora
    filters: {
      query: '',
      onlyMySubs: true,
      onlyItaDub: false,
      includeAsianAnim: false,
      mediaType: 'all', // 'all' | 'tv' | 'movie'
      subgenre: '',
      sortBy: 'popularity.desc',
      page: 1
    },

    // Risultati correnti in Esplora
    exploreItems: [],
    exploreHasMore: false,
    isLoadingExplore: false,

    // Watchlist: { ["tv_12345"]: { id, mediaType, title, originalTitle, posterPath, voteAverage, releaseYear, status: 'plan'|'watching'|'completed', addedAt, episodes, runtimeMinutes, totalMinutes, flatrateIds: [], freeIds: [], rentBuyIds: [], jwLink: '', autoItaHint: false } }
    watchlist: {},
    watchlistFilter: 'all',

    // Stato Doppiaggio ITA locale: { ["tv_12345"]: 'yes' | 'no' | 'unknown' }
    dubMap: {},

    // Cache dettagli TMDB: { ["tv_12345"]: { fetchedAt, episodes, runtimeMinutes, totalMinutes, flatrateIds, freeIds, rentBuyIds, jwLink, autoItaHint, overview, genres } }
    detailsCache: {}
  };

  /* ==========================================================================
     1. SAFE DOM HELPER (Zero innerHTML)
     ========================================================================== */

  function clearNode(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  /**
   * Crea un elemento DOM in modo sicuro senza mai usare innerHTML
   * @param {string} tag
   * @param {Object} attrs
   * @param {Array<Node|string>|Node|string} children
   * @returns {HTMLElement}
   */
  function el(tag, attrs = {}, children = []) {
    const element = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'className') {
        element.className = String(v);
      } else if (k === 'textContent') {
        element.textContent = String(v);
      } else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v)) {
          element.dataset[dk] = String(dv);
        }
      } else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          element.style[sk] = String(sv);
        }
      } else if (k.startsWith('on') && typeof v === 'function') {
        element.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v === true) {
        element.setAttribute(k, '');
      } else {
        element.setAttribute(k, String(v));
      }
    }

    const childArray = Array.isArray(children) ? children : [children];
    for (const child of childArray) {
      if (child === null || child === undefined || child === false) continue;
      if (child instanceof Node) {
        element.appendChild(child);
      } else {
        element.appendChild(document.createTextNode(String(child)));
      }
    }
    return element;
  }

  function showToast(message, durationMs = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = el('div', { className: 'toast-msg', textContent: message });
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, durationMs);
  }

  /* ==========================================================================
     2. STORAGE MANAGER (Persistenza locale sicura)
     ========================================================================== */

  function loadStateFromStorage() {
    // Default abbonamenti iniziali (Crunchyroll, Prime Video, RaiPlay attivi come demo iniziale se non c'è snapshot)
    const defaultSubs = {};
    for (const p of CFG.PROVIDERS) {
      defaultSubs[p.key] = {
        active: ['crunchyroll', 'prime_video', 'raiplay'].includes(p.key),
        cost: p.defaultCost
      };
    }

    try {
      const savedSettings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || 'null');
      if (savedSettings && typeof savedSettings === 'object') {
        state.settings = {
          ...state.settings,
          ...savedSettings,
          region: (savedSettings.region || CFG.DEFAULT_REGION).toUpperCase().trim()
        };
      }
    } catch (_) { /* ignore */ }

    try {
      const savedSubs = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBSCRIPTIONS) || 'null');
      if (savedSubs && savedSubs.providers) {
        state.subscriptions = { ...defaultSubs, ...savedSubs.providers };
        state.unrecognizedSheetRows = Array.isArray(savedSubs.unrecognized) ? savedSubs.unrecognized : [];
        state.lastSheetSync = savedSubs.lastSync || null;
      } else {
        state.subscriptions = defaultSubs;
      }
    } catch (_) {
      state.subscriptions = defaultSubs;
    }

    try {
      const savedWl = JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCHLIST) || 'null');
      if (savedWl && typeof savedWl === 'object') {
        state.watchlist = savedWl;
      }
    } catch (_) { /* ignore */ }

    try {
      const savedDub = JSON.parse(localStorage.getItem(STORAGE_KEYS.DUB_STATUS) || 'null');
      if (savedDub && typeof savedDub === 'object') {
        state.dubMap = savedDub;
      }
    } catch (_) { /* ignore */ }

    try {
      const savedCache = JSON.parse(localStorage.getItem(STORAGE_KEYS.DETAILS_CACHE) || 'null');
      if (savedCache && typeof savedCache === 'object') {
        state.detailsCache = savedCache;
      }
    } catch (_) { /* ignore */ }

    try {
      const savedPrivacy = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRIVACY_SHIELD) || 'null');
      if (savedPrivacy && savedPrivacy.pinHash) {
        state.privacy.hasPin = true;
        state.privacy.pinHash = savedPrivacy.pinHash;
        state.privacy.isLocked = true;
      }
    } catch (_) { /* ignore */ }
  }

  function savePrivacyState() {
    try {
      localStorage.setItem(
        STORAGE_KEYS.PRIVACY_SHIELD,
        JSON.stringify({ pinHash: state.privacy.pinHash })
      );
    } catch (_) { /* ignore */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
    } catch (_) { /* storage full */ }
  }

  function saveSubscriptionsSnapshot() {
    try {
      localStorage.setItem(
        STORAGE_KEYS.SUBSCRIPTIONS,
        JSON.stringify({
          providers: state.subscriptions,
          unrecognized: state.unrecognizedSheetRows,
          lastSync: state.lastSheetSync
        })
      );
    } catch (_) { /* ignore */ }
  }

  function saveWatchlist() {
    try {
      localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(state.watchlist));
      updateWatchlistBadge();
    } catch (_) { /* ignore */ }
  }

  function saveDubMap() {
    try {
      localStorage.setItem(STORAGE_KEYS.DUB_STATUS, JSON.stringify(state.dubMap));
    } catch (_) { /* ignore */ }
  }

  function saveDetailsCache() {
    try {
      // Mantiene solo le ultime 250 voci per non saturare localStorage
      const entries = Object.entries(state.detailsCache);
      if (entries.length > 250) {
        entries.sort((a, b) => (b[1].fetchedAt || 0) - (a[1].fetchedAt || 0));
        state.detailsCache = Object.fromEntries(entries.slice(0, 200));
      }
      localStorage.setItem(STORAGE_KEYS.DETAILS_CACHE, JSON.stringify(state.detailsCache));
    } catch (_) { /* ignore */ }
  }

  /* ==========================================================================
     3. PROVIDER HELPERS & GOOGLE SHEETS PARSER / SYNC
     ========================================================================== */

  function getActiveProviders() {
    return CFG.PROVIDERS.filter((p) => state.subscriptions[p.key]?.active);
  }

  function getActiveProviderTmdbIds() {
    const ids = new Set();
    for (const p of getActiveProviders()) {
      ids.add(p.id);
      if (Array.isArray(p.extraIds)) {
        for (const extId of p.extraIds) ids.add(extId);
      }
    }
    return Array.from(ids);
  }

  function findProviderByTmdbId(tmdbId) {
    const numId = Number(tmdbId);
    return CFG.PROVIDERS.find(
      (p) => p.id === numId || (Array.isArray(p.extraIds) && p.extraIds.includes(numId))
    ) || null;
  }

  function matchProviderByName(rawName) {
    if (!rawName) return null;
    const normalized = String(rawName)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9+ ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return null;

    for (const provider of CFG.PROVIDERS) {
      if (provider.name.toLowerCase() === normalized || provider.key === normalized) {
        return provider;
      }
      for (const alias of provider.aliases) {
        if (alias === normalized || normalized.includes(alias)) {
          return provider;
        }
      }
    }
    return null;
  }

  function parseBooleanStatus(rawVal) {
    if (typeof rawVal === 'boolean') return rawVal;
    const norm = String(rawVal || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    return ['si', 's', 'yes', 'y', 'true', '1', 'attivo', 'on', 'ok', 'x'].includes(norm);
  }

  function parseMonthlyCost(rawVal, fallbackCost = 0) {
    if (typeof rawVal === 'number' && !Number.isNaN(rawVal)) return Math.max(0, rawVal);
    const cleaned = String(rawVal || '')
      .replace(',', '.')
      .replace(/[^0-9.]/g, '')
      .trim();
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackCost;
  }

  function extractSheetId(rawInput) {
    const str = String(rawInput || '').trim();
    if (!str) return '';
    const match = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : str;
  }

  /**
   * Parser CSV RFC-4180 minimale per l'endpoint pubblico Google Sheets
   */
  function parseCsvRows(csvText) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const ch = csvText[i];
      const next = csvText[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          currentCell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          currentCell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell);
        currentCell = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        if (ch === '\r') i++;
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else if (ch !== '\r') {
        currentCell += ch;
      }
    }
    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell);
      rows.push(currentRow);
    }
    return rows;
  }

  /**
   * Applica le righe lette dal Foglio Google (2D array) allo stato abbonamenti
   */
  function applySheetRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Il foglio Google è vuoto o non contiene righe valide.');
    }

    // Individua se la prima riga è un'intestazione ("Piattaforma", "Attivo", "Costo...")
    let startRow = 0;
    let colPlatform = 0;
    let colActive = 1;
    let colCost = 2;

    const firstRowNorm = rows[0].map((c) =>
      String(c || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
    );

    const hasHeader = firstRowNorm.some(
      (h) => h.includes('piattaforma') || h.includes('servizio') || h.includes('attivo') || h.includes('costo')
    );

    if (hasHeader) {
      startRow = 1;
      firstRowNorm.forEach((h, idx) => {
        if (h.includes('piattaforma') || h.includes('servizio') || h.includes('provider') || h.includes('nome')) {
          colPlatform = idx;
        } else if (h.includes('attiv') || h.includes('stato') || h.includes('active')) {
          colActive = idx;
        } else if (h.includes('costo') || h.includes('prezzo') || h.includes('mensile') || h.includes('euro')) {
          colCost = idx;
        }
      });
    }

    // Reset tutti i provider noti a inattivo prima di applicare il foglio
    const updatedSubs = {};
    for (const p of CFG.PROVIDERS) {
      updatedSubs[p.key] = {
        active: false,
        cost: state.subscriptions[p.key]?.cost ?? p.defaultCost
      };
    }

    const unrecognized = [];
    let matchedCount = 0;

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      const rawPlatform = String(row[colPlatform] || '').trim();
      if (!rawPlatform) continue;

      const rawActive = row[colActive];
      const rawCost = row[colCost];

      const matched = matchProviderByName(rawPlatform);
      if (matched) {
        matchedCount++;
        updatedSubs[matched.key] = {
          active: parseBooleanStatus(rawActive),
          cost: parseMonthlyCost(rawCost, matched.defaultCost)
        };
      } else {
        unrecognized.push(rawPlatform);
      }
    }

    if (matchedCount === 0 && unrecognized.length === 0) {
      throw new Error('Nessuna piattaforma trovata nel foglio. Verifica le colonne Piattaforma | Attivo | Costo mensile.');
    }

    state.subscriptions = updatedSubs;
    state.unrecognizedSheetRows = unrecognized;
    state.lastSheetSync = new Date().toISOString();
    saveSubscriptionsSnapshot();
  }

  /**
   * Sincronizza Google Sheet:
   * 1) Se c'è un token OAuth in memoria (o forceOAuth = true), usa Google Sheets API v4 con Bearer token.
   * 2) Altrimenti, se c'è una Google API Key, usa Google Sheets API v4 con ?key=...
   * 3) Altrimenti, prova la lettura diretta del foglio condiviso col link (CSV export endpoint).
   */
  async function syncGoogleSheet({ forceOAuth = false } = {}) {
    const sheetId = extractSheetId(state.settings.sheetId);
    if (!sheetId) {
      showToast('Configura prima il Google Sheet ID nelle Impostazioni.');
      switchView('view-settings');
      return;
    }

    const syncBtn = document.getElementById('btn-sync-sheets');
    if (syncBtn) syncBtn.classList.add('spinning');

    try {
      if (forceOAuth) {
        await requestGisAccessToken();
      }

      const range = encodeURIComponent(state.settings.sheetRange || 'A1:C50');
      let rows = null;

      if (memoryAccessToken) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${memoryAccessToken}` }
        });
        if (res.status === 401 || res.status === 403) {
          memoryAccessToken = null;
          throw new Error('Token OAuth scaduto o permessi insufficienti sul foglio. Ripeti il login OAuth.');
        }
        if (!res.ok) {
          throw new Error(`Errore Google Sheets API (${res.status}).`);
        }
        const data = await res.json();
        rows = data.values || [];
      } else if (state.settings.googleApiKey) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}?key=${encodeURIComponent(state.settings.googleApiKey)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Impossibile leggere il foglio con API Key (${res.status}). Verifica che sia condiviso o usa OAuth.`);
        }
        const data = await res.json();
        rows = data.values || [];
      } else {
        // Modalità Zero-Popup: lettura diretta per fogli condivisi con "Chiunque abbia il link"
        const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&range=${range}`;
        const res = await fetch(csvUrl);
        if (!res.ok) {
          throw new Error('Foglio privato o non raggiungibile. Condividilo con "Chiunque abbia il link" oppure usa "Login OAuth & Sync".');
        }
        const csvText = await res.text();
        if (csvText.trim().startsWith('<!DOCTYPE html') || csvText.includes('accounts.google.com/ServiceLogin')) {
          throw new Error('Il foglio è privato. Clicca su "Login OAuth & Sync Foglio" in Impostazioni o condividi il foglio col link.');
        }
        rows = parseCsvRows(csvText);
      }

      applySheetRows(rows);
      renderAllHeaderAndSettings();
      showToast('Abbonamenti sincronizzati dal Google Sheet!');
      loadExploreCatalog({ reset: true });
    } catch (err) {
      showToast(err.message || 'Errore durante la sincronizzazione del foglio.');
      renderGlobalAlerts(err.message);
    } finally {
      if (syncBtn) syncBtn.classList.remove('spinning');
    }
  }

  /**
   * Richiede un Access Token OAuth 2.0 tramite Google Identity Services (Token Model)
   */
  function requestGisAccessToken() {
    return new Promise((resolve, reject) => {
      const clientId = (state.settings.googleClientId || CFG.GOOGLE_OAUTH_CLIENT_ID || '').trim();
      if (!clientId) {
        reject(new Error('Inserisci il Google OAuth Client ID nelle Impostazioni (o in config.js) per usare il login OAuth su fogli privati.'));
        return;
      }
      if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        reject(new Error('Libreria Google Identity Services non caricata (verifica la connessione internet).'));
        return;
      }

      gisTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: CFG.GOOGLE_SHEETS_SCOPE,
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            memoryAccessToken = tokenResponse.access_token;
            resolve(memoryAccessToken);
          } else {
            reject(new Error(tokenResponse?.error_description || 'Autorizzazione OAuth negata.'));
          }
        },
        error_callback: (err) => {
          reject(new Error(`Errore popup OAuth: ${err?.type || 'chiuso dall’utente'}`));
        }
      });

      gisTokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /* ==========================================================================
     4. TMDB API v3 CLIENT (Discover, Search, Enrichment & Dub Heuristics)
     ========================================================================== */

  function getVaultKey() {
    const seed = CFG.VAULT_SEED;
    const salt = CFG.VAULT_SALT || 0x5a;
    if (!Array.isArray(seed)) return '';
    return seed.map((b) => String.fromCharCode(b ^ salt)).join('');
  }

  function getEffectiveTmdbKey() {
    const userKey = (state.settings.tmdbKey || '').trim();
    return userKey || getVaultKey();
  }

  function hasTmdbKey() {
    return Boolean(getEffectiveTmdbKey());
  }

  async function tmdbFetch(endpoint, params = {}) {
    const rawKey = getEffectiveTmdbKey();
    if (!rawKey) {
      throw new Error('Chiave API TMDB non disponibile.');
    }

    const url = new URL(`${CFG.TMDB_BASE_URL}${endpoint}`);
    const headers = { Accept: 'application/json' };

    // Supporta sia API Key v3 (32 hex) sia Read Access Token v4 (JWT Bearer)
    if (rawKey.length > 45 || rawKey.startsWith('eyJ')) {
      headers.Authorization = `Bearer ${rawKey}`;
    } else {
      url.searchParams.set('api_key', rawKey);
    }

    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), { headers });
    if (res.status === 401) {
      throw new Error('TMDB API Key non valida (401 Unauthorized). Controlla le Impostazioni.');
    }
    if (!res.ok) {
      throw new Error(`Errore TMDB API (${res.status}).`);
    }
    return res.json();
  }

  function normalizeAnimeItem(raw, forcedMediaType) {
    const mediaType = forcedMediaType || raw.media_type || (raw.first_air_date !== undefined ? 'tv' : 'movie');
    const itemKey = `${mediaType}_${raw.id}`;
    const title = raw.title || raw.name || 'Senza titolo';
    const originalTitle = raw.original_title || raw.original_name || title;
    const dateStr = raw.first_air_date || raw.release_date || '';
    const releaseYear = dateStr ? dateStr.slice(0, 4) : '—';

    return {
      key: itemKey,
      id: raw.id,
      mediaType,
      title,
      originalTitle,
      overview: raw.overview || '',
      posterPath: raw.poster_path || null,
      voteAverage: Number(raw.vote_average || 0),
      popularity: Number(raw.popularity || 0),
      releaseYear,
      originalLanguage: raw.original_language || 'ja',
      genreIds: Array.isArray(raw.genre_ids) ? raw.genre_ids : []
    };
  }

  /**
   * Recupera e salva in cache locale i dettagli completi di un singolo anime:
   * - watch/providers per la regione selezionata (IT)
   * - numero episodi e durata per l'Ottimizzatore Tempo
   * - euristica traduzione/doppiaggio ITA
   */
  async function fetchAndCacheAnimeDetails(mediaType, id, { forceRefresh = false } = {}) {
    const key = `${mediaType}_${id}`;
    const cached = state.detailsCache[key];
    const now = Date.now();

    if (!forceRefresh && cached && now - (cached.fetchedAt || 0) < CFG.DETAILS_CACHE_TTL_MS) {
      return cached;
    }

    const data = await tmdbFetch(`/${mediaType}/${id}`, {
      language: CFG.DEFAULT_LANGUAGE,
      append_to_response: 'watch/providers,translations'
    });

    const region = (state.settings.region || CFG.DEFAULT_REGION).toUpperCase();
    const regionProviders = data['watch/providers']?.results?.[region] || {};

    const extractIds = (arr) =>
      Array.isArray(arr) ? arr.map((p) => Number(p.provider_id)) : [];

    const flatrateIds = extractIds([
      ...(regionProviders.flatrate || []),
      ...(regionProviders.free || []),
      ...(regionProviders.ads || [])
    ]);
    const rentBuyIds = extractIds([
      ...(regionProviders.rent || []),
      ...(regionProviders.buy || [])
    ]);

    // Calcolo durata totale in minuti
    let episodes = 1;
    let runtimeMinutes = CFG.DEFAULT_MOVIE_MINUTES;
    if (mediaType === 'tv') {
      episodes = Math.max(1, Number(data.number_of_episodes) || 12);
      const epRun =
        Array.isArray(data.episode_run_time) && data.episode_run_time.length > 0
          ? Number(data.episode_run_time[0])
          : Number(data.last_episode_to_air?.runtime) || CFG.DEFAULT_EPISODE_MINUTES;
      runtimeMinutes = epRun > 0 ? epRun : CFG.DEFAULT_EPISODE_MINUTES;
    } else {
      episodes = 1;
      runtimeMinutes = Number(data.runtime) > 0 ? Number(data.runtime) : CFG.DEFAULT_MOVIE_MINUTES;
    }

    const totalMinutes = episodes * runtimeMinutes;

    // Euristica Doppiaggio / Localizzazione ITA:
    // Controlla se esiste traduzione it-IT con overview/titolo localizzato e se è su piattaforme ITA (es. RaiPlay, Anime Generation, Netflix)
    const translations = data.translations?.translations || [];
    const itTrans = translations.find((t) => t.iso_639_1 === 'it');
    const hasItaDubProvider = flatrateIds.some((pid) => {
      const prov = findProviderByTmdbId(pid);
      return prov && (prov.key === 'raiplay' || prov.key === 'anime_generation');
    });
    const autoItaHint = Boolean(hasItaDubProvider || (itTrans && itTrans.data && itTrans.data.overview));

    const detailRecord = {
      fetchedAt: now,
      episodes,
      runtimeMinutes,
      totalMinutes,
      flatrateIds: Array.from(new Set(flatrateIds)),
      rentBuyIds: Array.from(new Set(rentBuyIds)),
      jwLink: regionProviders.link || `https://www.themoviedb.org/${mediaType}/${id}/watch?locale=${region}`,
      autoItaHint,
      overview: data.overview || '',
      genres: Array.isArray(data.genres) ? data.genres.map((g) => g.name) : []
    };

    state.detailsCache[key] = detailRecord;
    saveDetailsCache();

    // Se l'anime è in watchlist, aggiorna anche i suoi metadati per il Set Cover
    if (state.watchlist[key]) {
      state.watchlist[key] = {
        ...state.watchlist[key],
        episodes: detailRecord.episodes,
        runtimeMinutes: detailRecord.runtimeMinutes,
        totalMinutes: detailRecord.totalMinutes,
        flatrateIds: detailRecord.flatrateIds,
        rentBuyIds: detailRecord.rentBuyIds,
        jwLink: detailRecord.jwLink,
        autoItaHint: detailRecord.autoItaHint
      };
      saveWatchlist();
    }

    return detailRecord;
  }

  /**
   * Carica il catalogo anime in modalità Esplora (/discover) oppure Ricerca (/search)
   */
  async function loadExploreCatalog({ reset = false } = {}) {
    if (!hasTmdbKey()) {
      state.exploreItems = getOfflineFallbackItems();
      state.exploreHasMore = false;
      renderExploreGrid();
      renderGlobalAlerts();
      return;
    }

    if (reset) {
      state.filters.page = 1;
      state.exploreItems = [];
    }

    state.isLoadingExplore = true;
    renderExploreMeta('Caricamento catalogo anime in corso...');

    const page = state.filters.page;
    const query = state.filters.query.trim();
    const region = (state.settings.region || CFG.DEFAULT_REGION).toUpperCase();
    const activeProviderIds = getActiveProviderTmdbIds();
    const allowedLangs = state.filters.includeAsianAnim ? ['ja', 'zh', 'ko'] : ['ja'];

    try {
      let fetchedItems = [];
      let hasMorePages = false;

      if (query.length > 0) {
        // MODALITÀ RICERCA TESTUALE (/search/tv + /search/movie in parallelo)
        const requests = [];
        if (state.filters.mediaType === 'all' || state.filters.mediaType === 'tv') {
          requests.push(
            tmdbFetch('/search/tv', {
              query,
              language: CFG.DEFAULT_LANGUAGE,
              page
            }).then((r) => ({ type: 'tv', data: r }))
          );
        }
        if (state.filters.mediaType === 'all' || state.filters.mediaType === 'movie') {
          requests.push(
            tmdbFetch('/search/movie', {
              query,
              language: CFG.DEFAULT_LANGUAGE,
              page
            }).then((r) => ({ type: 'movie', data: r }))
          );
        }

        const responses = await Promise.all(requests);
        let rawList = [];
        for (const resp of responses) {
          if (resp.data.total_pages > page) hasMorePages = true;
          for (const item of resp.data.results || []) {
            rawList.push(normalizeAnimeItem(item, resp.type));
          }
        }

        // Filtra lato client solo per Animazione (genre 16) e lingua originale asiatica
        fetchedItems = rawList.filter(
          (item) =>
            item.genreIds.includes(CFG.ANIME_GENRE_ID) &&
            allowedLangs.includes(item.originalLanguage)
        );

        // Arricchisci in batch i primi 14 risultati per mostrare i badge provider e filtrare per "Miei Abbonamenti"
        const topSlice = fetchedItems.slice(0, 14);
        await Promise.allSettled(
          topSlice.map((item) => fetchAndCacheAnimeDetails(item.mediaType, item.id))
        );

        if (state.filters.onlyMySubs && activeProviderIds.length > 0) {
          fetchedItems = fetchedItems.filter((item) => {
            const det = state.detailsCache[item.key];
            if (!det) return false;
            return det.flatrateIds.some((id) => activeProviderIds.includes(id));
          });
        }
      } else {
        // MODALITÀ DISCOVER (/discover/tv e/o /discover/movie)
        const langParam = allowedLangs.join('|');
        const subgenreObj = CFG.SUBGENRES.find((g) => g.id === state.filters.subgenre);

        const buildDiscoverParams = (type) => {
          let genres = String(CFG.ANIME_GENRE_ID);
          if (subgenreObj && subgenreObj.id) {
            const extraG = type === 'movie' ? subgenreObj.movieAlt : subgenreObj.id;
            genres = `${CFG.ANIME_GENRE_ID},${extraG}`;
          }

          const sortBy =
            type === 'movie' && state.filters.sortBy === 'first_air_date.desc'
              ? 'primary_release_date.desc'
              : state.filters.sortBy;

          const params = {
            language: CFG.DEFAULT_LANGUAGE,
            sort_by: sortBy,
            with_genres: genres,
            with_original_language: langParam,
            watch_region: region,
            page
          };

          if (state.filters.onlyMySubs && activeProviderIds.length > 0) {
            params.with_watch_monetization_types = 'flatrate|free|ads';
            params.with_watch_providers = activeProviderIds.join('|');
          }
          return params;
        };

        const requests = [];
        if (state.filters.mediaType === 'all' || state.filters.mediaType === 'tv') {
          requests.push(
            tmdbFetch('/discover/tv', buildDiscoverParams('tv')).then((r) => ({ type: 'tv', data: r }))
          );
        }
        if (state.filters.mediaType === 'all' || state.filters.mediaType === 'movie') {
          requests.push(
            tmdbFetch('/discover/movie', buildDiscoverParams('movie')).then((r) => ({ type: 'movie', data: r }))
          );
        }

        const responses = await Promise.all(requests);
        for (const resp of responses) {
          if (resp.data.total_pages > page) hasMorePages = true;
          for (const item of resp.data.results || []) {
            fetchedItems.push(normalizeAnimeItem(item, resp.type));
          }
        }

        fetchedItems.sort((a, b) => b.popularity - a.popularity);

        // Pre-fetch leggero dei provider per i primi 8 titoli visibili in griglia
        Promise.allSettled(
          fetchedItems.slice(0, 8).map((it) => fetchAndCacheAnimeDetails(it.mediaType, it.id))
        ).then(() => {
          renderExploreGrid();
        });
      }

      // Deduplica
      const seen = new Set(state.exploreItems.map((i) => i.key));
      for (const item of fetchedItems) {
        if (!seen.has(item.key)) {
          seen.add(item.key);
          state.exploreItems.push(item);
        }
      }

      state.exploreHasMore = hasMorePages;
      renderGlobalAlerts();
    } catch (err) {
      if (state.exploreItems.length === 0) {
        state.exploreItems = getOfflineFallbackItems();
      }
      renderGlobalAlerts(err.message);
    } finally {
      state.isLoadingExplore = false;
      renderExploreGrid();
    }
  }

  /**
   * Restituisce i titoli presenti in Watchlist o in Cache locale quando si è offline o senza API Key
   */
  function getOfflineFallbackItems() {
    const wlItems = Object.values(state.watchlist);
    if (wlItems.length > 0) {
      return wlItems.map((w) => ({
        key: `${w.mediaType}_${w.id}`,
        id: w.id,
        mediaType: w.mediaType,
        title: w.title,
        originalTitle: w.originalTitle || w.title,
        overview: '',
        posterPath: w.posterPath || null,
        voteAverage: w.voteAverage || 0,
        popularity: 100,
        releaseYear: w.releaseYear || '—',
        originalLanguage: 'ja',
        genreIds: [16]
      }));
    }
    return [];
  }

  /* ==========================================================================
     5. DOPPIAGGIO ITALIANO (Tri-Stato Locale + Filtro)
     ========================================================================== */

  function getDubStatus(itemKey) {
    if (state.dubMap[itemKey]) return state.dubMap[itemKey];
    const cached = state.detailsCache[itemKey];
    if (cached && cached.autoItaHint) return 'yes';
    return 'unknown';
  }

  function cycleDubStatus(itemKey) {
    const current = getDubStatus(itemKey);
    const nextOrder = { unknown: 'yes', yes: 'no', no: 'unknown' };
    const next = nextOrder[current] || 'yes';
    state.dubMap[itemKey] = next;
    saveDubMap();
    return next;
  }

  function formatDubLabel(status) {
    if (status === 'yes') return '🎙️ ITA: Sì';
    if (status === 'no') return '🎙️ ITA: No';
    return '🎙️ ITA: ?';
  }

  /* ==========================================================================
     6. ANDROID INTENTS & DEEP LINKING (HyperOS / Chrome)
     ========================================================================== */

  function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent || '');
  }

  /**
   * Costruisce l'URI Android Intent nativo con S.browser_fallback_url
   * Esempio: intent://www.crunchyroll.com/it/search?q=Frieren#Intent;scheme=https;package=com.crunchyroll.crunchyroid;S.browser_fallback_url=...;end;
   */
  function buildProviderLaunchLinks(provider, animeTitle, fallbackJwUrl) {
    const encodedQuery = encodeURIComponent(animeTitle || '');
    const webSearchUrl = (provider.searchUrlTemplate || provider.homeUrl).replace('{query}', encodedQuery);

    if (!isAndroidDevice() || !provider.androidPackage) {
      return {
        primaryUrl: webSearchUrl,
        isIntent: false,
        webSearchUrl,
        jwUrl: fallbackJwUrl || provider.homeUrl
      };
    }

    const strippedUrl = webSearchUrl.replace(/^https?:\/\//i, '');
    const fallbackEncoded = encodeURIComponent(webSearchUrl);
    const intentUri = `intent://${strippedUrl}#Intent;scheme=https;package=${provider.androidPackage};S.browser_fallback_url=${fallbackEncoded};end;`;

    return {
      primaryUrl: intentUri,
      isIntent: true,
      webSearchUrl,
      jwUrl: fallbackJwUrl || provider.homeUrl
    };
  }

  async function copyTitleAndLaunch(animeTitle, targetUrl) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(animeTitle);
        showToast(`Titolo "${animeTitle}" copiato negli appunti!`);
      }
    } catch (_) { /* ignore clipboard errors */ }
    window.location.href = targetUrl;
  }

  /* ==========================================================================
     7. WATCHLIST & ALGORITMO OTTIMIZZATORE (WEIGHTED SET COVER + TEMPO)
     ========================================================================== */

  async function setWatchlistStatus(item, newStatus) {
    const key = item.key || `${item.mediaType}_${item.id}`;
    if (!newStatus || newStatus === 'none') {
      delete state.watchlist[key];
      saveWatchlist();
      showToast(`Rimosso dalla Watchlist: ${item.title}`);
      return;
    }

    const existing = state.watchlist[key] || {};
    const cached = state.detailsCache[key];

    state.watchlist[key] = {
      id: item.id,
      mediaType: item.mediaType,
      title: item.title,
      originalTitle: item.originalTitle || item.title,
      posterPath: item.posterPath || existing.posterPath || null,
      voteAverage: item.voteAverage || existing.voteAverage || 0,
      releaseYear: item.releaseYear || existing.releaseYear || '—',
      status: newStatus,
      addedAt: existing.addedAt || Date.now(),
      episodes: cached?.episodes || existing.episodes || (item.mediaType === 'tv' ? 12 : 1),
      runtimeMinutes: cached?.runtimeMinutes || existing.runtimeMinutes || (item.mediaType === 'tv' ? 24 : 105),
      totalMinutes: cached?.totalMinutes || existing.totalMinutes || (item.mediaType === 'tv' ? 288 : 105),
      flatrateIds: cached?.flatrateIds || existing.flatrateIds || [],
      rentBuyIds: cached?.rentBuyIds || existing.rentBuyIds || [],
      jwLink: cached?.jwLink || existing.jwLink || '',
      autoItaHint: cached?.autoItaHint || existing.autoItaHint || false
    };

    saveWatchlist();
    showToast(`Salvato in Watchlist (${formatWatchlistStatus(newStatus)})`);

    // Enrichment automatico in background se mancano i provider
    if (hasTmdbKey() && (!cached || !cached.flatrateIds)) {
      try {
        await fetchAndCacheAnimeDetails(item.mediaType, item.id);
        renderWatchlistView();
        renderOptimizerView();
      } catch (_) { /* silent background enrich */ }
    }
  }

  function formatWatchlistStatus(status) {
    if (status === 'plan') return 'Da vedere';
    if (status === 'watching') return 'In corso';
    if (status === 'completed') return 'Completato';
    return 'Non in lista';
  }

  /**
   * Esegue l'algoritmo Weighted Set Cover e il calcolo di Fattibilità Tempo / Rotazione Mensile
   * sui titoli in Watchlist con stato "watching" (In corso) e "plan" (Da vedere).
   */
  function computeOptimizationReport() {
    const activeWatchlist = Object.values(state.watchlist).filter(
      (item) => item.status === 'watching' || item.status === 'plan'
    );

    const activeSubs = getActiveProviders().map((p) => ({
      ...p,
      cost: Number(state.subscriptions[p.key]?.cost ?? p.defaultCost),
      allTmdbIds: [p.id, ...(p.extraIds || [])]
    }));

    const currentMonthlySpend = activeSubs.reduce((acc, s) => acc + s.cost, 0);

    // Mappa ogni anime attivo ai provider attivi dell'utente che lo includono in flatrate
    const coverableItems = [];
    const uncoveredItems = [];

    for (const item of activeWatchlist) {
      const fIds = Array.isArray(item.flatrateIds) ? item.flatrateIds : [];
      const matchingSubKeys = activeSubs
        .filter((sub) => sub.allTmdbIds.some((id) => fIds.includes(id)))
        .map((sub) => sub.key);

      if (matchingSubKeys.length > 0) {
        coverableItems.push({ ...item, matchingSubKeys });
      } else {
        uncoveredItems.push(item);
      }
    }

    // Algoritmo Weighted Set Cover:
    // Trova il sottoinsieme di activeSubs che copre tutti i coverableItems al COSTO MINIMO
    const uncoveredKeys = new Set(coverableItems.map((it) => `${it.mediaType}_${it.id}`));
    const chosenSubKeys = new Set();

    while (uncoveredKeys.size > 0) {
      let bestSub = null;
      let bestScore = -1;

      for (const sub of activeSubs) {
        if (chosenSubKeys.has(sub.key)) continue;
        // Quanti titoli non ancora coperti copre questo abbonamento?
        let newlyCovered = 0;
        let watchingBonus = 0;
        for (const item of coverableItems) {
          const ikey = `${item.mediaType}_${item.id}`;
          if (uncoveredKeys.has(ikey) && item.matchingSubKeys.includes(sub.key)) {
            newlyCovered++;
            if (item.status === 'watching') watchingBonus += 0.5;
          }
        }

        if (newlyCovered === 0) continue;

        // Pesa il numero di titoli coperti rispetto al costo mensile (se gratuito costo = 0.01 per priorità massima)
        const effectiveCost = Math.max(0.05, sub.cost);
        const score = (newlyCovered + watchingBonus) / effectiveCost;
        if (score > bestScore) {
          bestScore = score;
          bestSub = sub;
        }
      }

      if (!bestSub) break;
      chosenSubKeys.add(bestSub.key);
      for (const item of coverableItems) {
        const ikey = `${item.mediaType}_${item.id}`;
        if (item.matchingSubKeys.includes(bestSub.key)) {
          uncoveredKeys.delete(ikey);
        }
      }
    }

    // Classifica ciascun abbonamento attivo: Indispensabile vs Redundante/Superfluo
    const subBreakdown = activeSubs.map((sub) => {
      const titlesOnSub = coverableItems.filter((it) => it.matchingSubKeys.includes(sub.key));
      const uniqueTitles = titlesOnSub.filter((it) => it.matchingSubKeys.length === 1);
      const totalHours = titlesOnSub.reduce((sum, it) => sum + (Number(it.totalMinutes) || 288) / 60, 0);
      const watchingCount = titlesOnSub.filter((it) => it.status === 'watching').length;
      const isEssential = chosenSubKeys.has(sub.key);

      let reason = '';
      if (titlesOnSub.length === 0) {
        reason = 'Nessun anime della tua Watchlist attiva è presente su questa piattaforma.';
      } else if (!isEssential) {
        reason = `Redundante: tutti i suoi ${titlesOnSub.length} anime sono già inclusi negli altri tuoi abbonamenti attivi.`;
      } else if (uniqueTitles.length > 0) {
        reason = `Indispensabile per ${uniqueTitles.length} anime esclusivi (${titlesOnSub.length} totali, ${totalHours.toFixed(1)}h).`;
      } else {
        reason = `Scelto per il miglior rapporto copertura/prezzo (${titlesOnSub.length} anime, ${totalHours.toFixed(1)}h).`;
      }

      return {
        ...sub,
        titlesOnSub,
        uniqueTitles,
        totalHours,
        watchingCount,
        isEssential,
        reason
      };
    });

    const essentialMonthlySpend = subBreakdown
      .filter((s) => s.isEssential)
      .reduce((acc, s) => acc + s.cost, 0);
    const potentialMonthlySavings = Math.max(0, currentMonthlySpend - essentialMonthlySpend);

    // Calcolo Fattibilità Tempo & Rotazione Mensile
    const totalMinutesAll = activeWatchlist.reduce(
      (sum, it) => sum + (Number(it.totalMinutes) || 288),
      0
    );
    const totalHoursAll = totalMinutesAll / 60;
    const weeklyHours = Math.max(0.5, Number(state.settings.weeklyHours) || CFG.DEFAULT_WEEKLY_HOURS);
    const dailyHours = weeklyHours / 7;
    const monthlyHoursBudget = weeklyHours * 4.33;

    const estDays = totalHoursAll > 0 ? Math.ceil(totalHoursAll / dailyHours) : 0;
    const estMonths = totalHoursAll > 0 ? totalHoursAll / monthlyHoursBudget : 0;

    // Se il backlog supera la disponibilità di 1 mese, ordina i provider essenziali per priorità
    // (1° serie "In corso", 2° densità ore/costo) e suggerisce quali tenere nel mese corrente e quali mettere in pausa
    const prioritizedEssentials = subBreakdown
      .filter((s) => s.isEssential && s.cost > 0)
      .sort((a, b) => {
        if (b.watchingCount !== a.watchingCount) return b.watchingCount - a.watchingCount;
        return b.totalHours - a.totalHours;
      });

    let cumulativeHours = 0;
    const rotationPlan = prioritizedEssentials.map((sub, idx) => {
      const keepThisMonth = idx === 0 || cumulativeHours < monthlyHoursBudget * 0.85;
      cumulativeHours += sub.totalHours;
      return {
        ...sub,
        keepThisMonth,
        rotationAdvice: keepThisMonth
          ? `Tieni attivo QUESTO MESE (${sub.totalHours.toFixed(1)}h di catalogo prioritario da guardare).`
          : `Metti in PAUSA questo mese (risparmi € ${sub.cost.toFixed(2)}): il tuo budget di ${monthlyHoursBudget.toFixed(0)}h/mese è già saturo.`
      };
    });

    const rotationSavingsThisMonth =
      potentialMonthlySavings +
      rotationPlan.filter((r) => !r.keepThisMonth).reduce((acc, r) => acc + r.cost, 0);

    return {
      activeWatchlistCount: activeWatchlist.length,
      coverableCount: coverableItems.length,
      uncoveredItems,
      currentMonthlySpend,
      essentialMonthlySpend,
      potentialMonthlySavings,
      rotationSavingsThisMonth,
      totalHoursAll,
      weeklyHours,
      monthlyHoursBudget,
      estDays,
      estMonths,
      subBreakdown,
      rotationPlan
    };
  }

  /* ==========================================================================
     8. UI RENDERING (Safe DOM - Zero innerHTML)
     ========================================================================== */

  function renderGlobalAlerts(customErrorMsg = null) {
    const container = document.getElementById('global-alert-container');
    if (!container) return;
    clearNode(container);

    const frag = document.createDocumentFragment();

    if (!navigator.onLine) {
      frag.appendChild(
        el('div', { className: 'alert-box alert-warning' }, [
          el('span', {
            textContent: 'Sei offline. Stai visualizzando lo snapshot abbonamenti e i dati salvati in cache locale.'
          })
        ])
      );
    }

    if (!hasTmdbKey()) {
      frag.appendChild(
        el('div', { className: 'alert-box alert-info' }, [
          el('span', {
            textContent: 'Benvenuto! Inserisci la tua TMDB API Key nelle Impostazioni per sbloccare il catalogo anime in tempo reale.'
          }),
          el(
            'button',
            {
              type: 'button',
              className: 'alert-action-btn',
              textContent: 'Configura ora',
              onClick: () => switchView('view-settings')
            }
          )
        ])
      );
    }

    if (state.unrecognizedSheetRows.length > 0) {
      frag.appendChild(
        el('div', { className: 'alert-box alert-warning' }, [
          el('span', {
            textContent: `Servizi non riconosciuti nel Google Sheet: ${state.unrecognizedSheetRows.join(', ')}.`
          }),
          el(
            'button',
            {
              type: 'button',
              className: 'alert-action-btn',
              textContent: 'Dettagli',
              onClick: () => switchView('view-settings')
            }
          )
        ])
      );
    }

    if (customErrorMsg) {
      frag.appendChild(
        el('div', { className: 'alert-box alert-error' }, [
          el('span', { textContent: customErrorMsg })
        ])
      );
    }

    container.appendChild(frag);
  }

  function renderAllHeaderAndSettings() {
    const regionBadge = document.getElementById('header-region-badge');
    if (regionBadge) regionBadge.textContent = state.settings.region || CFG.DEFAULT_REGION;

    const activeSubs = getActiveProviders();
    const totalCost = activeSubs.reduce(
      (sum, p) => sum + Number(state.subscriptions[p.key]?.cost ?? p.defaultCost),
      0
    );

    const summaryEl = document.getElementById('header-subs-summary');
    if (summaryEl) {
      summaryEl.textContent =
        activeSubs.length > 0
          ? `${activeSubs.length} abbonamenti attivi (€ ${totalCost.toFixed(2)}/mese)`
          : 'Nessun abbonamento attivo selezionato';
    }

    // Barra pillole abbonamenti attivi in Esplora
    const strip = document.getElementById('active-providers-bar');
    if (strip) {
      clearNode(strip);
      const frag = document.createDocumentFragment();
      for (const p of activeSubs) {
        frag.appendChild(
          el('span', { className: 'sub-pill' }, [
            el('span', { className: 'sub-pill-dot', style: { backgroundColor: p.color } }),
            el('span', { textContent: p.name })
          ])
        );
      }
      strip.appendChild(frag);
    }

    renderSettingsView();
    updateWatchlistBadge();
  }

  function updateWatchlistBadge() {
    const badge = document.getElementById('nav-watchlist-count');
    if (!badge) return;
    const count = Object.keys(state.watchlist).length;
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  function renderExploreMeta(customText = null) {
    const meta = document.getElementById('explore-results-meta');
    if (!meta) return;
    clearNode(meta);

    if (customText) {
      meta.appendChild(el('span', { textContent: customText }));
      return;
    }

    const filtered = getFilteredExploreItems();
    meta.appendChild(
      el('span', {
        textContent: `${filtered.length} anime visualizzati`
      })
    );
    if (state.filters.onlyMySubs) {
      meta.appendChild(
        el('span', {
          textContent: `Filtro flatrate: ${state.settings.region}`
        })
      );
    }
  }

  function getFilteredExploreItems() {
    return state.exploreItems.filter((item) => {
      if (state.filters.onlyItaDub && getDubStatus(item.key) !== 'yes') {
        return false;
      }
      return true;
    });
  }

  /**
   * Costruisce una Card Anime completa (100% DOM API sicure)
   */
  function createAnimeCardElement(item) {
    const key = item.key || `${item.mediaType}_${item.id}`;
    const wlEntry = state.watchlist[key];
    const wlStatus = wlEntry ? wlEntry.status : 'none';
    const dubStatus = getDubStatus(key);
    const cachedDetails = state.detailsCache[key];
    const activeIds = getActiveProviderTmdbIds();

    // Poster
    const posterWrap = el('div', {
      className: 'card-poster-wrap',
      onClick: () => openAnimeDetailModal(item)
    });

    if (item.posterPath) {
      posterWrap.appendChild(
        el('img', {
          className: 'card-poster-img',
          src: `${CFG.TMDB_IMAGE_BASE}/w342${item.posterPath}`,
          alt: item.title,
          loading: 'lazy'
        })
      );
    } else {
      posterWrap.appendChild(
        el('div', { className: 'card-poster-fallback', textContent: item.title })
      );
    }

    // Top badges (TV/FILM + Voto)
    posterWrap.appendChild(
      el('div', { className: 'card-top-badges' }, [
        el('span', {
          className: 'badge-type',
          textContent: item.mediaType === 'tv' ? 'Serie TV' : 'Film'
        }),
        item.voteAverage > 0
          ? el('span', {
              className: 'badge-rating',
              textContent: `★ ${Number(item.voteAverage).toFixed(1)}`
            })
          : null
      ])
    );

    // Provider mini badges sulla locandina (se già presenti in cache)
    const fIds = cachedDetails?.flatrateIds || wlEntry?.flatrateIds || [];
    if (fIds.length > 0) {
      const overlay = el('div', { className: 'card-providers-overlay' });
      const shownKeys = new Set();
      for (const pid of fIds) {
        const prov = findProviderByTmdbId(pid);
        if (prov && !shownKeys.has(prov.key)) {
          shownKeys.add(prov.key);
          const isMySub = activeIds.includes(pid);
          overlay.appendChild(
            el('span', {
              className: `provider-mini-chip ${isMySub ? 'is-my-sub' : ''}`,
              textContent: prov.shortName
            })
          );
        }
      }
      posterWrap.appendChild(overlay);
    }

    // Titolo e metadati durata
    const durationText =
      cachedDetails || wlEntry
        ? `${cachedDetails?.episodes || wlEntry?.episodes} ep · ${(
            (cachedDetails?.totalMinutes || wlEntry?.totalMinutes || 24) / 60
          ).toFixed(1)}h`
        : item.releaseYear || '—';

    // Pulsante Tri-stato Doppiaggio ITA
    const dubBtn = el('button', {
      type: 'button',
      className: 'btn-dub-tristate',
      dataset: { dub: dubStatus },
      title: 'Tocca per cambiare stato Doppiaggio Italiano (Sì / No / Sconosciuto)',
      textContent: formatDubLabel(dubStatus),
      onClick: (e) => {
        e.stopPropagation();
        const next = cycleDubStatus(key);
        dubBtn.dataset.dub = next;
        dubBtn.textContent = formatDubLabel(next);
        if (state.filters.onlyItaDub) {
          renderExploreGrid();
        }
      }
    });

    // Select stato Watchlist
    const wlSelect = el(
      'select',
      {
        className: `select-watchlist-state ${wlStatus !== 'none' ? 'in-list' : ''}`,
        'aria-label': `Stato Watchlist per ${item.title}`,
        onChange: async (e) => {
          const val = e.target.value;
          wlSelect.classList.toggle('in-list', val !== 'none');
          await setWatchlistStatus(item, val);
        }
      },
      [
        el('option', { value: 'none', selected: wlStatus === 'none', textContent: '+ Watchlist' }),
        el('option', { value: 'plan', selected: wlStatus === 'plan', textContent: '📌 Da vedere' }),
        el('option', { value: 'watching', selected: wlStatus === 'watching', textContent: '▶️ In corso' }),
        el('option', { value: 'completed', selected: wlStatus === 'completed', textContent: '✅ Completato' })
      ]
    );

    const cardBody = el('div', { className: 'card-body' }, [
      el('h3', {
        className: 'card-title',
        textContent: item.title,
        onClick: () => openAnimeDetailModal(item)
      }),
      el('div', { className: 'card-meta-line' }, [
        el('span', { textContent: item.releaseYear || '—' }),
        el('span', { textContent: durationText })
      ]),
      el('div', { className: 'card-controls' }, [
        el('div', { className: 'card-actions-row' }, [dubBtn]),
        wlSelect
      ])
    ]);

    return el('article', { className: 'anime-card' }, [posterWrap, cardBody]);
  }

  function renderExploreGrid() {
    const grid = document.getElementById('explore-grid');
    const loadMoreBtn = document.getElementById('btn-load-more');
    if (!grid) return;

    clearNode(grid);
    renderExploreMeta();

    const items = getFilteredExploreItems();
    if (items.length === 0) {
      grid.appendChild(
        el('div', { className: 'empty-state' }, [
          el('strong', {
            textContent: hasTmdbKey()
              ? 'Nessun anime trovato con i filtri attuali.'
              : 'Configura la tua TMDB API Key per esplorare il catalogo.'
          }),
          el('p', {
            textContent: state.filters.onlyItaDub
              ? 'Prova a disattivare il filtro "Solo Doppiati ITA" o a taggare i tuoi anime preferiti.'
              : 'Prova a disattivare il filtro "Miei Abbonamenti" o cambia i termini di ricerca.'
          })
        ])
      );
      if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of items) {
      frag.appendChild(createAnimeCardElement(item));
    }
    grid.appendChild(frag);

    if (loadMoreBtn) {
      loadMoreBtn.classList.toggle('hidden', !state.exploreHasMore);
    }
  }

  function renderWatchlistView() {
    const grid = document.getElementById('watchlist-grid');
    const summaryText = document.getElementById('watchlist-summary-text');
    if (!grid) return;

    clearNode(grid);

    if (state.privacy.hasPin && state.privacy.isLocked) {
      if (summaryText) summaryText.textContent = '🔒 Contenuti personali protetti da PIN.';
      grid.appendChild(
        el('div', { className: 'empty-state' }, [
          el('strong', { textContent: '🔒 Watchlist Riservata Protetta' }),
          el('p', {
            textContent:
              'La modalità Privacy Shield è attiva. Inserisci il PIN per visualizzare la tua Watchlist.'
          }),
          el('button', {
            type: 'button',
            className: 'btn-primary',
            textContent: 'Sblocca con PIN',
            onClick: () => openPinModal(() => renderWatchlistView())
          })
        ])
      );
      return;
    }

    const allItems = Object.values(state.watchlist).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const filtered =
      state.watchlistFilter === 'all'
        ? allItems
        : allItems.filter((it) => it.status === state.watchlistFilter);

    const totalHours = filtered.reduce((acc, it) => acc + (Number(it.totalMinutes) || 288) / 60, 0);
    if (summaryText) {
      summaryText.textContent = `${filtered.length} titoli selezionati · Totale stimato: ${totalHours.toFixed(1)} ore`;
    }

    if (filtered.length === 0) {
      grid.appendChild(
        el('div', { className: 'empty-state' }, [
          el('strong', { textContent: 'Nessun anime in questa sezione della Watchlist.' }),
          el('p', { textContent: 'Aggiungi i titoli dalla scheda Esplora per attivare l’Ottimizzatore Budget & Tempo.' })
        ])
      );
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of filtered) {
      frag.appendChild(
        createAnimeCardElement({
          ...item,
          key: `${item.mediaType}_${item.id}`
        })
      );
    }
    grid.appendChild(frag);
  }

  function renderOptimizerView() {
    const report = computeOptimizationReport();

    const hoursLabel = document.getElementById('weekly-hours-display');
    if (hoursLabel) hoursLabel.textContent = `${report.weeklyHours} h/sett`;

    const subMetrics = document.getElementById('time-budget-submetrics');
    if (subMetrics) {
      clearNode(subMetrics);
      subMetrics.appendChild(
        el('span', { textContent: `Disponibilità mensile: ~${report.monthlyHoursBudget.toFixed(0)} ore/mese` })
      );
      subMetrics.appendChild(
        el('span', { textContent: `Backlog Watchlist: ${report.totalHoursAll.toFixed(1)} ore` })
      );
    }

    // KPI Grid
    const kpiContainer = document.getElementById('optimizer-kpis');
    if (kpiContainer) {
      clearNode(kpiContainer);
      const kpis = [
        {
          label: 'Spesa Mensile Attuale',
          value: `€ ${report.currentMonthlySpend.toFixed(2)}`,
          sub: `€ ${(report.currentMonthlySpend * 12).toFixed(0)} / anno`
        },
        {
          label: 'Risparmio Set Cover',
          value: `€ ${report.potentialMonthlySavings.toFixed(2)}/m`,
          sub:
            report.rotationSavingsThisMonth > report.potentialMonthlySavings
              ? `Fino a € ${report.rotationSavingsThisMonth.toFixed(2)}/m con rotazione`
              : 'Eliminando abbonamenti ridondanti'
        },
        {
          label: 'Copertura Watchlist',
          value: `${report.coverableCount} / ${report.activeWatchlistCount}`,
          sub: 'Titoli coperti dai tuoi abbonamenti'
        },
        {
          label: 'Tempo Completamento',
          value: report.estMonths >= 1 ? `${report.estMonths.toFixed(1)} mesi` : `${report.estDays} giorni`,
          sub: `${report.totalHoursAll.toFixed(1)} ore totali ("In corso" + "Da vedere")`
        }
      ];

      for (const k of kpis) {
        kpiContainer.appendChild(
          el('div', { className: 'kpi-box' }, [
            el('div', { className: 'kpi-label', textContent: k.label }),
            el('div', { className: 'kpi-value', textContent: k.value }),
            el('div', { className: 'kpi-sub', textContent: k.sub })
          ])
        );
      }
    }

    // Set Cover Breakdown
    const setCoverContainer = document.getElementById('optimizer-setcover-container');
    if (setCoverContainer) {
      clearNode(setCoverContainer);
      setCoverContainer.appendChild(
        el('h3', { className: 'section-title', textContent: '1. Analisi Set Cover (Indispensabili vs Superflui)' })
      );

      if (report.subBreakdown.length === 0) {
        setCoverContainer.appendChild(
          el('div', { className: 'empty-state', textContent: 'Attiva almeno un abbonamento nelle Impostazioni.' })
        );
      } else {
        for (const sub of report.subBreakdown) {
          const isKeep = sub.isEssential;
          setCoverContainer.appendChild(
            el('div', { className: `opt-provider-row ${isKeep ? 'status-keep' : 'status-drop'}` }, [
              el('div', { className: 'opt-row-head' }, [
                el('div', { className: 'opt-row-title' }, [
                  el('span', { className: 'provider-color-dot', style: { backgroundColor: sub.color } }),
                  el('span', { textContent: `${sub.name} (€ ${sub.cost.toFixed(2)}/mese)` })
                ]),
                el('span', {
                  className: `opt-badge ${isKeep ? 'opt-badge-keep' : 'opt-badge-drop'}`,
                  textContent: isKeep ? 'Indispensabile' : 'Superfluo / Disdici'
                })
              ]),
              el('p', { className: 'opt-row-desc', textContent: sub.reason })
            ])
          );
        }
      }
    }

    // Time Rotation Plan
    const rotationContainer = document.getElementById('optimizer-rotation-container');
    if (rotationContainer) {
      clearNode(rotationContainer);
      rotationContainer.appendChild(
        el('h3', {
          className: 'section-title',
          textContent: '2. Piano di Rotazione Mensile (Fattibilità Tempo)'
        })
      );

      if (report.rotationPlan.length <= 1) {
        rotationContainer.appendChild(
          el('div', { className: 'optimizer-card' }, [
            el('p', {
              className: 'section-desc',
              textContent:
                report.activeWatchlistCount === 0
                  ? 'Aggiungi gli anime che vuoi vedere nella Watchlist per calcolare il piano di rotazione mensile.'
                  : 'Hai già un solo abbonamento a pagamento essenziale: nessuna rotazione mensile necessaria.'
            })
          ])
        );
      } else {
        for (const rot of report.rotationPlan) {
          rotationContainer.appendChild(
            el('div', { className: `opt-provider-row ${rot.keepThisMonth ? 'status-keep' : 'status-pause'}` }, [
              el('div', { className: 'opt-row-head' }, [
                el('div', { className: 'opt-row-title' }, [
                  el('span', { className: 'provider-color-dot', style: { backgroundColor: rot.color } }),
                  el('span', { textContent: rot.name })
                ]),
                el('span', {
                  className: `opt-badge ${rot.keepThisMonth ? 'opt-badge-keep' : 'opt-badge-pause'}`,
                  textContent: rot.keepThisMonth ? 'Attivo Mese 1' : 'Pausa Mese 1'
                })
              ]),
              el('p', { className: 'opt-row-desc', textContent: rot.rotationAdvice })
            ])
          );
        }
      }

      if (report.uncoveredItems.length > 0) {
        const uncoveredNames = report.uncoveredItems.map((i) => i.title).join(', ');
        rotationContainer.appendChild(
          el('div', { className: 'alert-box alert-warning' }, [
            el('span', {
              textContent: `Nota: ${report.uncoveredItems.length} titoli in Watchlist (${uncoveredNames}) non risultano attualmente inclusi nei tuoi abbonamenti flatrate attivi.`
            })
          ])
        );
      }
    }
  }

  function renderSettingsView() {
    // Timestamp ultima sincronizzazione
    const syncBadge = document.getElementById('last-sync-timestamp');
    if (syncBadge) {
      if (state.lastSheetSync) {
        const d = new Date(state.lastSheetSync);
        syncBadge.textContent = `Sync: ${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', {
          hour: '2-digit',
          minute: '2-digit'
        })}`;
      } else {
        syncBadge.textContent = 'Locale / Non sincronizzato';
      }
    }

    // Box piattaforme non riconosciute
    const unrecBox = document.getElementById('unrecognized-platforms-box');
    if (unrecBox) {
      clearNode(unrecBox);
      if (state.unrecognizedSheetRows.length > 0) {
        unrecBox.classList.remove('hidden');
        unrecBox.appendChild(
          el('span', {
            textContent: `Attenzione: le seguenti righe del Google Sheet non corrispondono a nessun provider TMDB IT noto: "${state.unrecognizedSheetRows.join(
              '", "'
            )}".`
          })
        );
      } else {
        unrecBox.classList.add('hidden');
      }
    }

    // Lista interattiva abbonamenti
    const listContainer = document.getElementById('settings-providers-list');
    if (listContainer) {
      clearNode(listContainer);
      const frag = document.createDocumentFragment();

      for (const p of CFG.PROVIDERS) {
        const subState = state.subscriptions[p.key] || { active: false, cost: p.defaultCost };
        const isActive = Boolean(subState.active);

        const costInput = el('input', {
          type: 'number',
          className: 'cost-input',
          step: '0.01',
          min: '0',
          value: Number(subState.cost).toFixed(2),
          'aria-label': `Costo mensile ${p.name}`,
          onChange: (e) => {
            state.subscriptions[p.key] = {
              ...state.subscriptions[p.key],
              cost: parseMonthlyCost(e.target.value, p.defaultCost)
            };
            saveSubscriptionsSnapshot();
            renderAllHeaderAndSettings();
          }
        });

        const toggleBtn = el('button', {
          type: 'button',
          className: `switch-btn ${isActive ? 'on' : ''}`,
          textContent: isActive ? 'ATTIVO' : 'OFF',
          onClick: () => {
            state.subscriptions[p.key] = {
              active: !isActive,
              cost: state.subscriptions[p.key]?.cost ?? p.defaultCost
            };
            saveSubscriptionsSnapshot();
            renderAllHeaderAndSettings();
            if (state.filters.onlyMySubs) {
              loadExploreCatalog({ reset: true });
            }
          }
        });

        frag.appendChild(
          el('div', { className: `provider-config-item ${isActive ? 'active' : ''}` }, [
            el('div', { className: 'provider-info-col' }, [
              el('span', { className: 'provider-color-dot', style: { backgroundColor: p.color } }),
              el('span', { className: 'provider-name-label', textContent: p.name })
            ]),
            el('div', { className: 'provider-controls-col' }, [
              el('div', { className: 'cost-input-wrap' }, [
                el('span', { className: 'cost-currency', textContent: '€' }),
                costInput
              ]),
              toggleBtn
            ])
          ])
        );
      }
      listContainer.appendChild(frag);
    }

    // Popola i campi del form Impostazioni
    const setVal = (id, val) => {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = val || '';
    };
    setVal('input-tmdb-key', state.settings.tmdbKey);
    setVal('input-sheet-id', state.settings.sheetId);
    setVal('input-sheet-range', state.settings.sheetRange);
    setVal('input-watch-region', state.settings.region);
    setVal('input-google-client-id', state.settings.googleClientId);
    setVal('input-google-api-key', state.settings.googleApiKey);

    const pinStatusText = document.getElementById('pin-status-text');
    const removePinBtn = document.getElementById('btn-remove-pin');
    const pinInput = document.getElementById('input-privacy-pin');
    if (pinStatusText) {
      if (state.privacy.hasPin) {
        pinStatusText.textContent =
          '🔒 PIN Privacy attivo: la Watchlist e i dati personali sono protetti da sguardi indiscreti.';
        if (removePinBtn) removePinBtn.classList.remove('hidden');
        if (pinInput) pinInput.value = '';
      } else {
        pinStatusText.textContent =
          'Nessun PIN impostato. Le ricerche restano comunque volatili in RAM (zero cronologia su disco).';
        if (removePinBtn) removePinBtn.classList.add('hidden');
      }
    }
    updatePrivacyShieldHeaderBtn();
  }

  /* ==========================================================================
     8B. PRIVACY SHIELD & PIN KEYPAD HELPERS
     ========================================================================== */

  let pinSuccessCallback = null;

  async function hashPin(pin) {
    if (!pin) return '';
    const enc = new TextEncoder();
    const data = enc.encode(`salt_animewatch_${pin}`);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function openPinModal(onSuccess) {
    pinSuccessCallback = onSuccess || null;
    state.privacy.pinBuffer = '';
    updatePinDots();
    renderPinKeypad();
    const modal = document.getElementById('privacy-pin-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function closePinModal() {
    state.privacy.pinBuffer = '';
    const modal = document.getElementById('privacy-pin-modal');
    if (modal) modal.classList.add('hidden');
  }

  function updatePinDots() {
    const dots = document.querySelectorAll('#pin-dots-display .pin-dot-indicator');
    const len = state.privacy.pinBuffer.length;
    dots.forEach((dot, idx) => {
      dot.classList.toggle('filled', idx < len);
    });
  }

  function renderPinKeypad() {
    const keypad = document.getElementById('pin-keypad');
    if (!keypad) return;
    clearNode(keypad);
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
    const frag = document.createDocumentFragment();
    for (const k of keys) {
      frag.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: `pin-key-btn ${k === 'C' || k === '⌫' ? 'action-btn' : ''}`,
            textContent: k,
            onClick: async () => {
              if (k === 'C') {
                state.privacy.pinBuffer = '';
                updatePinDots();
              } else if (k === '⌫') {
                state.privacy.pinBuffer = state.privacy.pinBuffer.slice(0, -1);
                updatePinDots();
              } else if (state.privacy.pinBuffer.length < 4) {
                state.privacy.pinBuffer += k;
                updatePinDots();
                if (state.privacy.pinBuffer.length === 4) {
                  await verifyPinAttempt();
                }
              }
            }
          }
        )
      );
    }
    keypad.appendChild(frag);
  }

  async function verifyPinAttempt() {
    const candidateHash = await hashPin(state.privacy.pinBuffer);
    if (candidateHash === state.privacy.pinHash) {
      state.privacy.isLocked = false;
      closePinModal();
      updatePrivacyShieldHeaderBtn();
      showToast('Privacy Shield sbloccato!');
      if (typeof pinSuccessCallback === 'function') {
        pinSuccessCallback();
      } else {
        renderWatchlistView();
        renderOptimizerView();
      }
    } else {
      showToast('PIN errato.');
      state.privacy.pinBuffer = '';
      updatePinDots();
    }
  }

  function updatePrivacyShieldHeaderBtn() {
    const btn = document.getElementById('btn-privacy-shield');
    const label = document.getElementById('privacy-shield-label');
    if (!btn || !label) return;

    if (state.privacy.hasPin) {
      if (state.privacy.isLocked) {
        btn.classList.add('shield-locked');
        label.textContent = 'Sblocca';
        btn.title = 'Privacy Shield: Dati protetti da PIN. Tocca per sbloccare';
      } else {
        btn.classList.remove('shield-locked');
        label.textContent = 'Blocca';
        btn.title = 'Privacy Shield: Dati visibili. Tocca per bloccare all’istante';
      }
    } else {
      btn.classList.remove('shield-locked');
      label.textContent = 'Privato';
      btn.title = 'Privacy Shield attivo: zero cronologia salvata. Tocca per pulire la sessione';
    }
  }

  function executePanicWipe() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('btn-clear-search');
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    state.filters.query = '';
    if (state.privacy.hasPin) {
      state.privacy.isLocked = true;
      updatePrivacyShieldHeaderBtn();
    }
    loadExploreCatalog({ reset: true });
    renderWatchlistView();
    showToast('Tutte le ricerche e tracce di sessione sono state azzerate!');
  }

  /* ==========================================================================
     9. MODALE DETTAGLIO ANIME & DEEP LINKING ANDROID INTENTS
     ========================================================================== */

  async function openAnimeDetailModal(item) {
    const modal = document.getElementById('anime-detail-modal');
    const titleEl = document.getElementById('modal-anime-title');
    const bodyEl = document.getElementById('modal-body-content');
    if (!modal || !bodyEl) return;

    const key = item.key || `${item.mediaType}_${item.id}`;
    titleEl.textContent = item.title;
    clearNode(bodyEl);
    modal.classList.remove('hidden');

    bodyEl.appendChild(
      el('p', { className: 'modal-overview', textContent: 'Caricamento disponibilità streaming e dettagli...' })
    );

    let details = state.detailsCache[key];
    if (hasTmdbKey()) {
      try {
        details = await fetchAndCacheAnimeDetails(item.mediaType, item.id);
        renderExploreGrid();
      } catch (_) { /* usa eventuale cache */ }
    }

    clearNode(bodyEl);
    const frag = document.createDocumentFragment();

    // Hero Section
    const heroInfo = el('div', { className: 'modal-hero-info' }, [
      el('div', { className: 'modal-orig-title', textContent: `Titolo originale: ${item.originalTitle}` }),
      el('div', { className: 'modal-chips' }, [
        el('span', { className: 'modal-chip', textContent: item.mediaType === 'tv' ? 'Serie TV' : 'Film' }),
        el('span', { className: 'modal-chip', textContent: `Anno: ${item.releaseYear}` }),
        details
          ? el('span', {
              className: 'modal-chip',
              textContent: `${details.episodes} ep · ${(details.totalMinutes / 60).toFixed(1)} ore totali`
            })
          : null,
        item.voteAverage > 0
          ? el('span', { className: 'modal-chip', textContent: `★ ${Number(item.voteAverage).toFixed(1)} TMDB` })
          : null
      ])
    ]);

    const heroRow = el('div', { className: 'modal-hero' }, [
      item.posterPath
        ? el('img', {
            className: 'modal-poster',
            src: `${CFG.TMDB_IMAGE_BASE}/w342${item.posterPath}`,
            alt: item.title
          })
        : null,
      heroInfo
    ]);
    frag.appendChild(heroRow);

    // Sezione Streaming & Android Intents
    frag.appendChild(
      el('h3', {
        className: 'section-title',
        textContent: `Dove guardarlo in streaming (${state.settings.region})`
      })
    );

    const launchList = el('div', { className: 'provider-launch-list' });
    const flatrateIds = details?.flatrateIds || [];
    const rentBuyIds = details?.rentBuyIds || [];
    const activeIds = getActiveProviderTmdbIds();

    // Costruisce le righe di lancio per le piattaforme flatrate disponibili
    const matchedFlatrateProviders = [];
    const seenKeys = new Set();
    for (const pid of flatrateIds) {
      const prov = findProviderByTmdbId(pid);
      if (prov && !seenKeys.has(prov.key)) {
        seenKeys.add(prov.key);
        matchedFlatrateProviders.push({
          provider: prov,
          isMyActiveSub: activeIds.includes(pid)
        });
      }
    }

    // Ordina mettendo in cima i propri abbonamenti attivi
    matchedFlatrateProviders.sort((a, b) => Number(b.isMyActiveSub) - Number(a.isMyActiveSub));

    if (matchedFlatrateProviders.length > 0) {
      for (const entry of matchedFlatrateProviders) {
        const prov = entry.provider;
        const links = buildProviderLaunchLinks(prov, item.title, details?.jwLink);

        launchList.appendChild(
          el('div', { className: `provider-launch-card ${entry.isMyActiveSub ? 'active-sub' : ''}` }, [
            el('div', { className: 'provider-info-col' }, [
              el('span', { className: 'provider-color-dot', style: { backgroundColor: prov.color } }),
              el('div', {}, [
                el('div', { className: 'provider-name-label', textContent: prov.name }),
                el('div', {
                  className: 'form-hint',
                  textContent: entry.isMyActiveSub ? '✅ Incluso nel tuo abbonamento attivo' : 'Abbonamento non attivo'
                })
              ])
            ]),
            el('div', { className: 'launch-actions' }, [
              el('a', {
                className: `btn-launch-intent ${entry.isMyActiveSub ? '' : 'secondary'}`,
                href: links.primaryUrl,
                target: links.isIntent ? '_self' : '_blank',
                rel: 'noopener noreferrer',
                textContent: links.isIntent ? 'Apri App' : 'Cerca su Web'
              }),
              el('button', {
                type: 'button',
                className: 'btn-copy-launch',
                title: 'Copia il titolo negli appunti e apri l’app/sito',
                textContent: '📋+Apri',
                onClick: () => copyTitleAndLaunch(item.title, links.primaryUrl)
              })
            ])
          ])
        );
      }
    } else {
      launchList.appendChild(
        el('div', { className: 'alert-box alert-warning' }, [
          el('span', {
            textContent:
              'Nessun provider flatrate rilevato su TMDB IT per questo titolo (o verifica i tuoi launcher rapidi qui sotto).'
          })
        ])
      );

      // Mostra comunque i launcher rapidi per i propri abbonamenti attivi (utile per cercare direttamente nell'app)
      for (const prov of getActiveProviders()) {
        const links = buildProviderLaunchLinks(prov, item.title, details?.jwLink);
        launchList.appendChild(
          el('div', { className: 'provider-launch-card' }, [
            el('div', { className: 'provider-info-col' }, [
              el('span', { className: 'provider-color-dot', style: { backgroundColor: prov.color } }),
              el('span', { className: 'provider-name-label', textContent: `Cerca su ${prov.name}` })
            ]),
            el('div', { className: 'launch-actions' }, [
              el('a', {
                className: 'btn-launch-intent secondary',
                href: links.primaryUrl,
                target: links.isIntent ? '_self' : '_blank',
                rel: 'noopener noreferrer',
                textContent: links.isIntent ? 'Intent App' : 'Apri Web'
              })
            ])
          ])
        );
      }
    }

    // Eventuali provider a noleggio/acquisto
    if (rentBuyIds.length > 0) {
      const rentNames = [];
      for (const rid of rentBuyIds) {
        const rp = findProviderByTmdbId(rid);
        if (rp && !rentNames.includes(rp.name)) rentNames.push(rp.name);
      }
      if (rentNames.length > 0) {
        launchList.appendChild(
          el('p', {
            className: 'form-hint',
            textContent: `Disponibile anche a noleggio/acquisto su: ${rentNames.join(', ')}.`
          })
        );
      }
    }

    // Fallback universale JustWatch / TMDB
    const jwFallbackUrl =
      details?.jwLink ||
      `https://www.themoviedb.org/${item.mediaType}/${item.id}/watch?locale=${state.settings.region}`;
    launchList.appendChild(
      el('a', {
        className: 'btn-outline-sm',
        href: jwFallbackUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        textContent: '🔗 Apri pagina ufficiale TMDB / JustWatch (Fallback)'
      })
    );

    frag.appendChild(launchList);

    // Trama
    const overviewText = details?.overview || item.overview || 'Nessuna descrizione in italiano disponibile.';
    frag.appendChild(el('p', { className: 'modal-overview', textContent: overviewText }));

    bodyEl.appendChild(frag);
  }

  function closeAnimeDetailModal() {
    const modal = document.getElementById('anime-detail-modal');
    if (modal) modal.classList.add('hidden');
  }

  /* ==========================================================================
     10. NAVIGATION, EVENT LISTENERS & SERVICE WORKER REGISTRATION
     ========================================================================== */

  function switchView(targetViewId) {
    const views = document.querySelectorAll('.app-view');
    views.forEach((v) => {
      const isMatch = v.id === targetViewId;
      v.classList.toggle('active', isMatch);
      v.classList.toggle('hidden', !isMatch);
    });

    const navButtons = document.querySelectorAll('.bottom-nav .nav-item');
    navButtons.forEach((btn) => {
      const isMatch = btn.dataset.target === targetViewId;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', String(isMatch));
    });

    if (targetViewId === 'view-watchlist') {
      renderWatchlistView();
    } else if (targetViewId === 'view-optimizer') {
      renderOptimizerView();
    } else if (targetViewId === 'view-settings') {
      renderSettingsView();
    }
  }

  function initSubgenresDropdown() {
    const select = document.getElementById('select-subgenre');
    if (!select) return;
    clearNode(select);
    for (const sg of CFG.SUBGENRES) {
      select.appendChild(el('option', { value: sg.id, textContent: sg.label }));
    }
  }

  function bindEvents() {
    // Bottom Navigation
    document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.target));
    });

    // Online / Offline listeners
    const updateNetBadge = () => {
      const badge = document.getElementById('network-status-badge');
      if (badge) {
        const online = navigator.onLine;
        badge.textContent = online ? 'Online' : 'Offline';
        badge.className = `status-pill ${online ? 'status-online' : 'status-offline'}`;
      }
      renderGlobalAlerts();
    };
    window.addEventListener('online', updateNetBadge);
    window.addEventListener('offline', updateNetBadge);
    updateNetBadge();

    // Header Sync Button
    document.getElementById('btn-sync-sheets')?.addEventListener('click', () => {
      syncGoogleSheet({ forceOAuth: false });
    });

    // Search input with debounce
    let searchTimer = null;
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('btn-clear-search');

    searchInput?.addEventListener('input', (e) => {
      const val = e.target.value;
      clearBtn?.classList.toggle('hidden', val.length === 0);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.filters.query = val;
        loadExploreCatalog({ reset: true });
      }, 380);
    });

    clearBtn?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      clearBtn.classList.add('hidden');
      state.filters.query = '';
      loadExploreCatalog({ reset: true });
    });

    // Quick Filter Chips
    const bindToggleChip = (id, filterProp, reloadApi = true) => {
      const btn = document.getElementById(id);
      btn?.addEventListener('click', () => {
        state.filters[filterProp] = !state.filters[filterProp];
        btn.classList.toggle('active', state.filters[filterProp]);
        btn.setAttribute('aria-pressed', String(state.filters[filterProp]));
        if (reloadApi) {
          loadExploreCatalog({ reset: true });
        } else {
          renderExploreGrid();
        }
      });
    };

    bindToggleChip('toggle-my-subs', 'onlyMySubs', true);
    bindToggleChip('toggle-ita-dub', 'onlyItaDub', false);
    bindToggleChip('toggle-asian-anim', 'includeAsianAnim', true);

    // Selectors
    document.getElementById('select-media-type')?.addEventListener('change', (e) => {
      state.filters.mediaType = e.target.value;
      loadExploreCatalog({ reset: true });
    });
    document.getElementById('select-subgenre')?.addEventListener('change', (e) => {
      state.filters.subgenre = e.target.value;
      loadExploreCatalog({ reset: true });
    });
    document.getElementById('select-sort')?.addEventListener('change', (e) => {
      state.filters.sortBy = e.target.value;
      loadExploreCatalog({ reset: true });
    });

    // Load More
    document.getElementById('btn-load-more')?.addEventListener('click', () => {
      state.filters.page += 1;
      loadExploreCatalog({ reset: false });
    });

    // Watchlist Tabs
    document.querySelectorAll('.watchlist-tabs .wl-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.watchlist-tabs .wl-tab').forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        state.watchlistFilter = tab.dataset.wlFilter || 'all';
        renderWatchlistView();
      });
    });

    // Enrich all watchlist button
    document.getElementById('btn-enrich-all-watchlist')?.addEventListener('click', async () => {
      if (!hasTmdbKey()) {
        showToast('Configura prima la TMDB API Key nelle Impostazioni.');
        return;
      }
      const items = Object.values(state.watchlist);
      if (items.length === 0) return;
      showToast(`Aggiornamento di ${items.length} titoli in corso...`);
      await Promise.allSettled(
        items.map((it) => fetchAndCacheAnimeDetails(it.mediaType, it.id, { forceRefresh: true }))
      );
      renderWatchlistView();
      renderOptimizerView();
      showToast('Dati Watchlist aggiornati!');
    });

    // Optimizer Weekly Hours Slider
    const hoursSlider = document.getElementById('input-weekly-hours');
    if (hoursSlider) {
      hoursSlider.value = String(state.settings.weeklyHours || CFG.DEFAULT_WEEKLY_HOURS);
      hoursSlider.addEventListener('input', (e) => {
        state.settings.weeklyHours = Number(e.target.value);
        saveSettings();
        renderOptimizerView();
      });
    }

    // Settings Save Button
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      state.settings.tmdbKey = (document.getElementById('input-tmdb-key')?.value || '').trim();
      state.settings.sheetId = (document.getElementById('input-sheet-id')?.value || '').trim();
      state.settings.sheetRange = (document.getElementById('input-sheet-range')?.value || 'A1:C50').trim();
      state.settings.region = (document.getElementById('input-watch-region')?.value || 'IT')
        .toUpperCase()
        .trim();
      state.settings.googleClientId = (document.getElementById('input-google-client-id')?.value || '').trim();
      state.settings.googleApiKey = (document.getElementById('input-google-api-key')?.value || '').trim();

      saveSettings();
      renderAllHeaderAndSettings();
      renderGlobalAlerts();
      showToast('Impostazioni salvate localmente!');
      loadExploreCatalog({ reset: true });
    });

    // OAuth Sync Button
    document.getElementById('btn-oauth-sync')?.addEventListener('click', () => {
      state.settings.sheetId = (document.getElementById('input-sheet-id')?.value || state.settings.sheetId).trim();
      state.settings.googleClientId = (
        document.getElementById('input-google-client-id')?.value || state.settings.googleClientId
      ).trim();
      saveSettings();
      syncGoogleSheet({ forceOAuth: true });
    });

    // Backup Export / Import / Clear Cache
    document.getElementById('btn-export-data')?.addEventListener('click', () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        subscriptions: state.subscriptions,
        watchlist: state.watchlist,
        dubMap: state.dubMap
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', {
        href: url,
        download: `animewatch-backup-${new Date().toISOString().slice(0, 10)}.json`
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    document.getElementById('input-import-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed.watchlist && typeof parsed.watchlist === 'object') {
          state.watchlist = { ...state.watchlist, ...parsed.watchlist };
          saveWatchlist();
        }
        if (parsed.dubMap && typeof parsed.dubMap === 'object') {
          state.dubMap = { ...state.dubMap, ...parsed.dubMap };
          saveDubMap();
        }
        if (parsed.subscriptions && typeof parsed.subscriptions === 'object') {
          state.subscriptions = { ...state.subscriptions, ...parsed.subscriptions };
          saveSubscriptionsSnapshot();
        }
        renderAllHeaderAndSettings();
        renderExploreGrid();
        showToast('Backup importato con successo!');
      } catch (_) {
        showToast('File JSON non valido.');
      }
    });

    document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
      state.detailsCache = {};
      localStorage.removeItem(STORAGE_KEYS.DETAILS_CACHE);
      showToast('Cache metadati TMDB svuotata.');
    });

    // Privacy Shield Events
    document.getElementById('btn-privacy-shield')?.addEventListener('click', () => {
      if (state.privacy.hasPin) {
        if (state.privacy.isLocked) {
          openPinModal();
        } else {
          state.privacy.isLocked = true;
          updatePrivacyShieldHeaderBtn();
          renderWatchlistView();
          renderOptimizerView();
          showToast('Dati personali bloccati!');
        }
      } else {
        executePanicWipe();
      }
    });

    document.getElementById('btn-panic-wipe')?.addEventListener('click', executePanicWipe);

    document.getElementById('btn-save-pin')?.addEventListener('click', async () => {
      const pinVal = (document.getElementById('input-privacy-pin')?.value || '').trim();
      if (!/^\d{4}$/.test(pinVal)) {
        showToast('Inserisci un PIN numerico di esattamente 4 cifre.');
        return;
      }
      state.privacy.pinHash = await hashPin(pinVal);
      state.privacy.hasPin = true;
      state.privacy.isLocked = false;
      savePrivacyState();
      renderSettingsView();
      showToast('PIN Privacy impostato con successo!');
    });

    document.getElementById('btn-remove-pin')?.addEventListener('click', () => {
      state.privacy.pinHash = '';
      state.privacy.hasPin = false;
      state.privacy.isLocked = false;
      savePrivacyState();
      renderSettingsView();
      renderWatchlistView();
      showToast('PIN Privacy rimosso.');
    });

    document.getElementById('btn-close-pin-modal')?.addEventListener('click', closePinModal);
    document.getElementById('privacy-pin-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'privacy-pin-modal') closePinModal();
    });

    // Auto-Lock quando l'utente cambia app o spegne lo schermo
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.privacy.hasPin) {
        state.privacy.isLocked = true;
        updatePrivacyShieldHeaderBtn();
        if (document.getElementById('view-watchlist')?.classList.contains('active')) {
          renderWatchlistView();
        }
        if (document.getElementById('view-optimizer')?.classList.contains('active')) {
          renderOptimizerView();
        }
      }
    });

    // Modal Close
    document.getElementById('btn-close-modal')?.addEventListener('click', closeAnimeDetailModal);
    document.getElementById('anime-detail-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'anime-detail-modal') closeAnimeDetailModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAnimeDetailModal();
    });

    // Native PWA WebAPK install prompt handler
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredInstallPrompt = e;
      showPwaInstallBanner();
      updatePwaInstallUi();
    });

    window.addEventListener('appinstalled', () => {
      window.deferredInstallPrompt = null;
      hidePwaInstallBanner();
      updatePwaInstallUi();
      showToast('AnimeWatch installata con successo come app!');
    });

    const triggerBtn = document.getElementById('btn-trigger-pwa-install');
    if (triggerBtn) {
      triggerBtn.addEventListener('click', async () => {
        if (window.deferredInstallPrompt) {
          window.deferredInstallPrompt.prompt();
          const choice = await window.deferredInstallPrompt.userChoice;
          if (choice.outcome === 'accepted') {
            showToast('Installazione avviata sul tuo telefono!');
          }
          window.deferredInstallPrompt = null;
          hidePwaInstallBanner();
          updatePwaInstallUi();
        } else if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
          showToast('AnimeWatch è già installata e aperta come app!');
        } else {
          showToast('Tocca i 3 puntini in alto a destra in Chrome ➔ "Installa applicazione"');
        }
      });
    }

    updatePwaInstallUi();
  }

  function updatePwaInstallUi() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const badge = document.getElementById('pwa-install-status-badge');
    const triggerBtn = document.getElementById('btn-trigger-pwa-install');
    if (badge) {
      if (isStandalone) {
        badge.textContent = '✅ Installata';
        badge.className = 'meta-badge badge-active';
      } else if (window.deferredInstallPrompt) {
        badge.textContent = '⚡ Pronta per l\'installazione';
        badge.className = 'meta-badge badge-ready';
      } else {
        badge.textContent = 'WebAPK';
      }
    }
    if (triggerBtn && isStandalone) {
      triggerBtn.textContent = '✅ Applicazione già installata';
      triggerBtn.disabled = true;
      triggerBtn.classList.add('btn-disabled');
    }
  }

  function showPwaInstallBanner() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) return;
    const existing = document.getElementById('pwa-install-banner');
    if (existing) return;
    const container = document.getElementById('global-alert-container');
    if (!container) return;

    const banner = el('div', { id: 'pwa-install-banner', className: 'alert-box alert-info' }, [
      el('span', { textContent: '📱 Installa AnimeWatch come vera applicazione nativa sul tuo telefono.' }),
      el('button', {
        type: 'button',
        className: 'alert-action-btn',
        textContent: 'Installa Ora',
        onClick: async () => {
          if (window.deferredInstallPrompt) {
            window.deferredInstallPrompt.prompt();
            const choice = await window.deferredInstallPrompt.userChoice;
            if (choice.outcome === 'accepted') {
              showToast('Installazione avviata!');
            }
            window.deferredInstallPrompt = null;
            hidePwaInstallBanner();
            updatePwaInstallUi();
          }
        }
      })
    ]);
    container.insertBefore(banner, container.firstChild);
  }

  function hidePwaInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      const doRegister = () => {
        navigator.serviceWorker
          .register('./sw.js', { scope: './' })
          .then((reg) => {
            // Forza l'aggiornamento immediato del service worker
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          })
          .catch(() => {});
      };

      if (document.readyState === 'complete') {
        doRegister();
      } else {
        window.addEventListener('load', doRegister);
      }
    }
  }

  /* ==========================================================================
     11. BOOTSTRAP
     ========================================================================== */

  function initApp() {
    loadStateFromStorage();
    initSubgenresDropdown();
    bindEvents();
    renderAllHeaderAndSettings();
    renderGlobalAlerts();
    loadExploreCatalog({ reset: true });
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
