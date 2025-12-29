(function() {
  'use strict';

  if (window.MapConfigLoaded) {
    return;
  }
  window.MapConfigLoaded = true;

  window.CONFIG = {
    STYLE_URL: 'mapbox://styles/akimmaksimenka/cmjigq0ij001g01sg4bkg996c',
    CONTAINER_ID: 'globe-map',
    INITIAL_CENTER: [12, 25],
    LATITUDE_MIN: -30,
    LATITUDE_MAX: 30,
    INITIAL_ZOOM: 5,
    INITIAL_LATITUDE_OFFSET: -30,
    ENABLE_PROJECTION_FIX: true,
    COUNTRY_COLOR: '#F3223F',
    COUNTRY_FOCUS_COLOR: '#C71F37',
    COUNTRY_STROKE_COLOR: '#FFFFFF',
    COUNTRY_STROKE_WIDTH: 1,
    COUNTRY_FILL_OPACITY: 0.9,
    COUNTRIES_GEOJSON_URL: 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
    MIN_COORDINATES_THRESHOLD: 10000,
    LIST_HOVER_FOCUS_DELAY_MS: 120,
    LIST_HOVER_UNFOCUS_DELAY_MS: 150,
    LIST_FOCUS_ANIMATION_DURATION_MS: 900,
    LIST_FOCUS_OFFSET_Y_RATIO: 0.3,
    LIST_FOCUS_OFFSET_Y_RATIO_MOBILE: 0.12,
    LIST_FOCUS_OFFSET_BREAKPOINT_PX: 767,
    ATTRIBUTES: {
      COUNTRY_ITEM: 'data-map-country-item',
      LIST_ITEM: 'data-map-list-item',
      COUNTRY_NAME: 'data-map-country-name',
      COUNTRY_ISO: 'data-map-country-iso',
      TOOLTIP: 'data-map-tooltip',
      OFFICE_ITEM: 'data-map-office-item',
      OFFICE_ADDRESS: 'data-map-office-address',
      OFFICE_NAME: 'data-map-office-name',
      OFFICE_DESCRIPTION: 'data-map-office-description',
      OFFICE_PHONE: 'data-map-office-phone',
      OFFICE_EMAIL: 'data-map-office-email',
      OFFICE_LINK: 'data-map-office-link',
      MODAL: 'data-map-modal',
      MODAL_CLOSE: 'data-map-modal-close'
    }
  };

  window.COUNTRY_NAME_ALIASES = new Map([
    ['czech rep', 'czech republic'],
    ['czech rep.', 'czech republic'],
    ['czechia', 'czech republic'],
    ['cech rep', 'czech republic'],
    ['cech rep.', 'czech republic']
  ]);

  window.normalizeIsoCode = function(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    return normalized;
  };

  window.normalizeCountryName = function(value) {
    const base = String(value ?? '').toLowerCase().trim();
    if (!base) return '';

    const cleaned = base
      .replace(/[\u2019']/g, '')
      .replace(/[().,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return window.COUNTRY_NAME_ALIASES.get(cleaned) || cleaned;
  };

})();
