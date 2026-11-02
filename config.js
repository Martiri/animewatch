/**
 * Anime Stream Optimizer PWA — Configurazione Globale e Mappa Provider
 * Nessun segreto personale è salvato in questo file.
 * Sheet ID e TMDB API Key vengono configurati da UI e salvati in localStorage.
 */

'use strict';

window.APP_CONFIG = Object.freeze({
  APP_NAME: 'AnimeWatch IT',
  APP_VERSION: '1.0.0',

  // OAuth 2.0 Client ID per Google Identity Services (opzionale se il foglio è condiviso col link)
  // Può essere inserito qui o sovrascritto direttamente dalle Impostazioni dell'app.
  GOOGLE_OAUTH_CLIENT_ID: '',

  // Scope minimo in sola lettura per Google Sheets API v4
  GOOGLE_SHEETS_SCOPE: 'https://www.googleapis.com/auth/spreadsheets.readonly',

  // Parametri TMDB API v3
  TMDB_BASE_URL: 'https://api.themoviedb.org/3',
  TMDB_IMAGE_BASE: 'https://image.tmdb.org/t/p',
  DEFAULT_REGION: 'IT',
  DEFAULT_LANGUAGE: 'it-IT',
  ANIME_GENRE_ID: 16,
  ANIME_KEYWORD_ID: 210024,

  // Parametri di default per l'Ottimizzatore Tempo
  DEFAULT_WEEKLY_HOURS: 7, // 1 ora al giorno
  DEFAULT_EPISODE_MINUTES: 24,
  DEFAULT_MOVIE_MINUTES: 105,

  // Cache TTL (in millisecondi)
  DETAILS_CACHE_TTL_MS: 1000 * 60 * 60 * 24 * 7, // 7 giorni per metadati/provider singoli anime

  /**
   * Mappa Ufficiale dei Provider Streaming (Regione IT - TMDB / JustWatch)
   * Include:
   * - id: ID primario TMDB watch_provider
   * - extraIds: eventuali ID secondari TMDB associati (es. Netflix Standard with Ads, canali Prime)
   * - name: Nome visualizzato
   * - shortName: Nome compatto per i badge delle card
   * - color: Colore brand per i pill badge
   * - defaultCost: Costo mensile di riferimento in € (usato solo per il template iniziale)
   * - aliases: Sinonimi case-insensitive per il parsing tollerante del Google Sheet
   * - androidPackage: Package name dell'app Android ufficiale (HyperOS / Google Play)
   * - searchUrlTemplate: URL di ricerca web (usato come S.browser_fallback_url nell'intent Android e su desktop)
   * - homeUrl: URL home del servizio
   * - likelyItaDub: true se la piattaforma trasmette prevalentemente contenuti con doppiaggio/localizzazione ITA
   */
  PROVIDERS: Object.freeze([
    {
      key: 'crunchyroll',
      id: 283,
      extraIds: [],
      name: 'Crunchyroll',
      shortName: 'CR',
      color: '#f47521',
      defaultCost: 6.49,
      aliases: ['crunchyroll', 'crunchy', 'cr', 'crunchyroll mega fan', 'crunchyroll fan'],
      androidPackage: 'com.crunchyroll.crunchyroid',
      searchUrlTemplate: 'https://www.crunchyroll.com/it/search?q={query}',
      homeUrl: 'https://www.crunchyroll.com/it',
      likelyItaDub: false
    },
    {
      key: 'netflix',
      id: 8,
      extraIds: [1796], // 1796 = Netflix Standard with Ads
      name: 'Netflix',
      shortName: 'NF',
      color: '#e50914',
      defaultCost: 13.99,
      aliases: ['netflix', 'nf', 'netflix standard', 'netflix premium', 'netflix base', 'netflix ads'],
      androidPackage: 'com.netflix.mediaclient',
      searchUrlTemplate: 'https://www.netflix.com/search?q={query}',
      homeUrl: 'https://www.netflix.com/it/',
      likelyItaDub: true
    },
    {
      key: 'prime_video',
      id: 119,
      extraIds: [2100],
      name: 'Amazon Prime Video',
      shortName: 'Prime',
      color: '#00a8e1',
      defaultCost: 4.99,
      aliases: ['prime video', 'amazon prime video', 'amazon prime', 'prime', 'amazon', 'primevideo'],
      androidPackage: 'com.amazon.avod.thirdpartyclient',
      searchUrlTemplate: 'https://www.primevideo.com/search/ref=atv_nb_sr?phrase={query}',
      homeUrl: 'https://www.primevideo.com/',
      likelyItaDub: true
    },
    {
      key: 'anime_generation',
      id: 1895,
      extraIds: [],
      name: 'Anime Generation',
      shortName: 'AnimeGen',
      color: '#ec4899',
      defaultCost: 4.99,
      aliases: ['anime generation', 'animegeneration', 'yamato', 'yamato video', 'canale anime generation'],
      androidPackage: 'com.amazon.avod.thirdpartyclient',
      searchUrlTemplate: 'https://www.primevideo.com/search/ref=atv_nb_sr?phrase={query}',
      homeUrl: 'https://www.primevideo.com/storefront/subscription/animegeneration',
      likelyItaDub: true
    },
    {
      key: 'disney_plus',
      id: 337,
      extraIds: [],
      name: 'Disney+',
      shortName: 'D+',
      color: '#3b82f6',
      defaultCost: 9.99,
      aliases: ['disney+', 'disney plus', 'disneyplus', 'disney', 'star'],
      androidPackage: 'com.disney.disneyplus',
      searchUrlTemplate: 'https://www.disneyplus.com/it-it/search?q={query}',
      homeUrl: 'https://www.disneyplus.com/it-it',
      likelyItaDub: true
    },
    {
      key: 'raiplay',
      id: 222,
      extraIds: [],
      name: 'RaiPlay',
      shortName: 'RaiPlay',
      color: '#2563eb',
      defaultCost: 0.00,
      aliases: ['raiplay', 'rai play', 'rai'],
      androidPackage: 'it.rainet',
      searchUrlTemplate: 'https://www.raiplay.it/ricerca.html?q={query}',
      homeUrl: 'https://www.raiplay.it/',
      likelyItaDub: true
    },
    {
      key: 'now',
      id: 39,
      extraIds: [29], // Sky Go
      name: 'NOW / Sky',
      shortName: 'NOW',
      color: '#10b981',
      defaultCost: 8.99,
      aliases: ['now', 'now tv', 'nowtv', 'sky', 'sky go', 'skygo'],
      androidPackage: 'it.sky.anytime',
      searchUrlTemplate: 'https://www.nowtv.it/ricerca?q={query}',
      homeUrl: 'https://www.nowtv.it/',
      likelyItaDub: true
    },
    {
      key: 'paramount_plus',
      id: 531,
      extraIds: [582],
      name: 'Paramount+',
      shortName: 'P+',
      color: '#0064ff',
      defaultCost: 7.99,
      aliases: ['paramount+', 'paramount plus', 'paramount', 'paramountplus'],
      androidPackage: 'com.cbs.ca',
      searchUrlTemplate: 'https://www.paramountplus.com/it/search/?q={query}',
      homeUrl: 'https://www.paramountplus.com/it/',
      likelyItaDub: true
    },
    {
      key: 'apple_tv',
      id: 350,
      extraIds: [2],
      name: 'Apple TV+',
      shortName: 'AppleTV',
      color: '#94a3b8',
      defaultCost: 9.99,
      aliases: ['apple tv+', 'apple tv plus', 'apple tv', 'appletv+', 'appletv'],
      androidPackage: 'com.apple.atve.androidtv.appletv',
      searchUrlTemplate: 'https://tv.apple.com/it/search?term={query}',
      homeUrl: 'https://tv.apple.com/it',
      likelyItaDub: true
    },
    {
      key: 'mediaset_infinity',
      id: 359,
      extraIds: [],
      name: 'Mediaset Infinity',
      shortName: 'Infinity',
      color: '#8b5cf6',
      defaultCost: 0.00,
      aliases: ['mediaset infinity', 'infinity', 'infinity+', 'mediaset'],
      androidPackage: 'it.rti.newmediasetplay',
      searchUrlTemplate: 'https://mediasetinfinity.mediaset.it/ricerca?q={query}',
      homeUrl: 'https://mediasetinfinity.mediaset.it/',
      likelyItaDub: true
    },
    {
      key: 'timvision',
      id: 109,
      extraIds: [],
      name: 'TIMVISION',
      shortName: 'TIM',
      color: '#0284c7',
      defaultCost: 6.99,
      aliases: ['timvision', 'tim vision', 'tim'],
      androidPackage: 'it.telecomitalia.cubovision',
      searchUrlTemplate: 'https://www.timvision.it/search?q={query}',
      homeUrl: 'https://www.timvision.it/',
      likelyItaDub: true
    },
    {
      key: 'pluto_tv',
      id: 300,
      extraIds: [],
      name: 'Pluto TV',
      shortName: 'Pluto',
      color: '#eab308',
      defaultCost: 0.00,
      aliases: ['pluto tv', 'plutotv', 'pluto'],
      androidPackage: 'tv.pluto.android',
      searchUrlTemplate: 'https://pluto.tv/it/search?q={query}',
      homeUrl: 'https://pluto.tv/it',
      likelyItaDub: true
    },
    {
      key: 'youtube',
      id: 192,
      extraIds: [],
      name: 'YouTube (Yamato / Muse)',
      shortName: 'YT',
      color: '#ef4444',
      defaultCost: 0.00,
      aliases: ['youtube', 'yt', 'youtube premium', 'yamato animation'],
      androidPackage: 'com.google.android.youtube',
      searchUrlTemplate: 'https://www.youtube.com/results?search_query={query}+anime+ita',
      homeUrl: 'https://www.youtube.com/',
      likelyItaDub: false
    }
  ]),

  // Sottogeneri TMDB combinabili con Genere 16 (Animazione)
  SUBGENRES: Object.freeze([
    { id: '', label: 'Tutti i generi' },
    { id: '10759', movieAlt: '28', label: 'Azione & Avventura' },
    { id: '10765', movieAlt: '14', label: 'Fantasy & Sci-Fi' },
    { id: '35', movieAlt: '35', label: 'Commedia' },
    { id: '18', movieAlt: '18', label: 'Dramma' },
    { id: '9648', movieAlt: '9648', label: 'Mistero & Thriller' },
    { id: '10749', movieAlt: '10749', label: 'Romantico' }
  ])
});
