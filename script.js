const CONFIG = {
  STYLE_URL: 'mapbox://styles/akimmaksimenka/cmjigq0ij001g01sg4bkg996c', // Хостится в Mapbox
  CONTAINER_ID: 'globe-map',
  INITIAL_CENTER: [12, 25], // Начальный центр: Европа в фокусе (долгота ~12°E, широта ~25°N)
  LATITUDE_MIN: -30, // Минимальная широта (ограничивает прокрутку к северному полюсу)
  LATITUDE_MAX: 30,  // Максимальная широта (ограничивает прокрутку к южному полюсу)
  INITIAL_ZOOM: 5,
  INITIAL_LATITUDE_OFFSET: -30, // Глобус начинается с наклоном на -30 градусов по широте
  ENABLE_PROJECTION_FIX: true,
  COUNTRY_COLOR: '#F3223F',
  COUNTRY_FOCUS_COLOR: '#C71F37',
  COUNTRY_STROKE_COLOR: '#FFFFFF',
  COUNTRY_STROKE_WIDTH: 1,
  COUNTRY_FILL_OPACITY: 0.9, // Увеличена непрозрачность для более насыщенного цвета
  COUNTRIES_GEOJSON_URL: 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
  MIN_COORDINATES_THRESHOLD: 10000,
  LIST_HOVER_FOCUS_DELAY_MS: 120,
  LIST_HOVER_UNFOCUS_DELAY_MS: 150,
  LIST_FOCUS_ANIMATION_DURATION_MS: 900,
  LIST_FOCUS_OFFSET_Y_RATIO: 0.15, // Сдвигает страну вверх при фокусе из списка (0.15 = 15% высоты контейнера)
  DEBUG_LOGS: true,
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

const COUNTRY_NAME_ALIASES = new Map([
  ['czech rep', 'czech republic'],
  ['czech rep.', 'czech republic'],
  ['czechia', 'czech republic'],
  ['cech rep', 'czech republic'],
  ['cech rep.', 'czech republic']
]);

function normalizeIsoCode(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized;
}

function normalizeCountryName(value) {
  const base = String(value ?? '').toLowerCase().trim();
  if (!base) return '';

  const cleaned = base
    .replace(/[\u2019']/g, '')
    .replace(/[().,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return COUNTRY_NAME_ALIASES.get(cleaned) || cleaned;
}

class MapController {
  constructor(config) {
    this.config = config;
    this.map = null;
    this.geocodingService = null;
    this.countriesManager = null;
    this.officesManager = null;
    this.tooltipManager = null;
    this.modalManager = null;
    this.listFocusManager = null;
    this.wheelInterferenceProtectionActive = false;
    this._wheelInterferenceCleanup = null;
    this._wheelInterferenceMediaQuery = null;
    this._cameraAnimationSequence = 0;
  }

  async loadStyle() {
    if (!this.config.STYLE_URL) {
      throw new Error('Style URL is not configured');
    }

    return this.config.STYLE_URL;
  }

  disableMapControls() {
    this.map.scrollZoom.disable();
    this.map.boxZoom.disable();
    this.map.doubleClickZoom.disable();
    this.map.touchZoomRotate.disable();
    this.map.dragRotate.disable();
    this.map.keyboard.disable();

    if (this.map.touchPitch) {
      this.map.touchPitch.disable();
    }
  }

  limitVerticalRotation() {
    let isCorrecting = false;

    const clampLatitude = (lat) => Math.max(
      this.config.LATITUDE_MIN,
      Math.min(this.config.LATITUDE_MAX, lat)
    );

    const correctLatitude = () => {
      if (isCorrecting) return;

      const { lat, lng } = this.map.getCenter();

      if (lat < this.config.LATITUDE_MIN || lat > this.config.LATITUDE_MAX) {
        isCorrecting = true;

        this.map.easeTo({
          center: [lng, clampLatitude(lat)],
          duration: 0,
          essential: true
        });

        requestAnimationFrame(() => {
          isCorrecting = false;
        });
      }
    };

    ['move', 'drag', 'moveend'].forEach(event => {
      this.map.on(event, correctLatitude);
    });

  }

  preventAutoZoom() {
    let isCorrectingZoom = false;
    let programmaticZoomChange = false;
    let cachedTargetZoom = this.calculateGlobeZoom();

    const ZOOM_TOLERANCE = 0.001;
    const PITCH_TOLERANCE = 0.001;

    const correctZoomAndPitch = () => {
      if (programmaticZoomChange || isCorrectingZoom) return;

      const currentZoom = this.map.getZoom();
      const currentPitch = this.map.getPitch();

      if (Math.abs(currentZoom - cachedTargetZoom) > ZOOM_TOLERANCE) {
        isCorrectingZoom = true;
        this.map.easeTo({
          zoom: cachedTargetZoom,
          duration: 0,
          essential: true
        });
        requestAnimationFrame(() => {
          isCorrectingZoom = false;
        });
      }

      if (Math.abs(currentPitch) > PITCH_TOLERANCE) {
        this.map.setPitch(0);
      }
    };

    ['move', 'zoom', 'drag'].forEach(event => {
      this.map.on(event, correctZoomAndPitch);
    });

    this._setProgrammaticZoomChange = (value) => {
      programmaticZoomChange = value;
    };

    this._updateTargetZoom = () => {
      cachedTargetZoom = this.calculateGlobeZoom();
    };

    this._setTargetZoom = (zoom) => {
      cachedTargetZoom = zoom;
    };

    this._getTargetZoom = () => cachedTargetZoom;

  }

  easeToCamera({ center, zoom, duration, easing, offset }) {
    if (!this.map) return;

    const hasZoom = typeof zoom === 'number' && Number.isFinite(zoom);
    const options = { duration, essential: true };

    if (center) options.center = center;
    if (hasZoom) options.zoom = zoom;
    if (typeof easing === 'function') options.easing = easing;
    if (Array.isArray(offset) && offset.length === 2) options.offset = offset;

    this._cameraAnimationSequence += 1;
    const sequence = this._cameraAnimationSequence;

    if (hasZoom) {
      this.map.setMinZoom(0);
      this.map.setMaxZoom(22);
      if (typeof this._setProgrammaticZoomChange === 'function') {
        this._setProgrammaticZoomChange(true);
      }
      if (typeof this._setTargetZoom === 'function') {
        this._setTargetZoom(zoom);
      }

      const finalize = () => {
        if (sequence !== this._cameraAnimationSequence) return;
        this.map.setMinZoom(zoom);
        this.map.setMaxZoom(zoom);
        if (typeof this._setProgrammaticZoomChange === 'function') {
          this._setProgrammaticZoomChange(false);
        }
      };

      if (duration > 0) {
        this.map.once('moveend', finalize);
      } else {
        finalize();
      }
    }

    this.map.stop();
    this.map.easeTo(options);
  }

  fixProjectionScaler() {
    const transform = this.map?.transform;
    if (!transform) {
      return false;
    }

    if (!transform._originalCameraToCenterDistanceDescriptor) {
      transform._originalCameraToCenterDistanceDescriptor = Object.getOwnPropertyDescriptor(transform, 'cameraToCenterDistance');
    }
    if (!transform._originalPixelsPerMercatorPixelDescriptor) {
      transform._originalPixelsPerMercatorPixelDescriptor = Object.getOwnPropertyDescriptor(transform, '_pixelsPerMercatorPixel');
    }

    const fixedDistance = transform._fixedCameraToCenterDistance ?? transform.cameraToCenterDistance;
    const fixedPixels = transform._fixedPixelsPerMercatorPixel ?? transform._pixelsPerMercatorPixel;

    transform._fixedCameraToCenterDistance = fixedDistance;
    transform._fixedPixelsPerMercatorPixel = fixedPixels;

    if (!transform._cameraDistanceFixed) {
      try {
        const createFixedProperty = (propName, fixedValue) => ({
          get: () => fixedValue,
          set: () => {}, // Игнорируем попытки установить новое значение
          configurable: true,
          enumerable: true
        });

        Object.defineProperty(transform, 'cameraToCenterDistance', createFixedProperty('cameraToCenterDistance', fixedDistance));
        Object.defineProperty(transform, '_pixelsPerMercatorPixel', createFixedProperty('_pixelsPerMercatorPixel', fixedPixels));

        transform._cameraDistanceFixed = true;
        return true;
      } catch (e) {
      }
    }

    return true;
  }

  unfixProjectionScaler() {
    if (!this.map || !this.map.transform) {
      return false;
    }

    const transform = this.map.transform;

    if (!transform._cameraDistanceFixed) {
      return false;
    }

    try {
      if (transform._originalCameraToCenterDistanceDescriptor) {
        Object.defineProperty(transform, 'cameraToCenterDistance', transform._originalCameraToCenterDistanceDescriptor);
      }
      if (transform._originalPixelsPerMercatorPixelDescriptor) {
        Object.defineProperty(transform, '_pixelsPerMercatorPixel', transform._originalPixelsPerMercatorPixelDescriptor);
      }

      delete transform._cameraDistanceFixed;

      return true;
    } catch (e) {
      return false;
    }
  }

  calculateGlobeZoom() {
    const container = document.getElementById(this.config.CONTAINER_ID);
    if (!container) return this.config.INITIAL_ZOOM;

    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;
    const minDimension = Math.min(containerWidth, containerHeight);

    const referenceSize = 2200; // Референсный размер контейнера (при нём GLOBE_BASE_SIZE=150 идеально)
    const baseGlobeSize = 150;

    const sizeCorrection = (minDimension - referenceSize) * 0.02;
    const GLOBE_BASE_SIZE = baseGlobeSize - sizeCorrection;

    const zoom = Math.log2(minDimension / GLOBE_BASE_SIZE);

    return zoom;
  }

  updateGlobeZoom() {
    if (!this.map) return;

    if (this.config.ENABLE_PROJECTION_FIX && this.unfixProjectionScaler) {
      this.unfixProjectionScaler();
    }

    const newZoom = this.calculateGlobeZoom();

    this.map.setMinZoom(0);
    this.map.setMaxZoom(22);
    this.map.setZoom(newZoom);
    this.map.resize();

    this.map.setMinZoom(newZoom);
    this.map.setMaxZoom(newZoom);
  }

  async init() {
    if (!window.MAPBOX_ACCESS_TOKEN) {
      return;
    }

    mapboxgl.accessToken = window.MAPBOX_ACCESS_TOKEN;

    const styleData = await this.loadStyle();

    const initialZoom = this.calculateGlobeZoom();

    const initialLatitude = this.config.INITIAL_CENTER[1] + this.config.INITIAL_LATITUDE_OFFSET;
    const initialCenter = [this.config.INITIAL_CENTER[0], initialLatitude];

    this.map = new mapboxgl.Map({
      container: this.config.CONTAINER_ID,
      style: styleData,
      center: initialCenter, // Начальный центр с наклоном для анимации
      zoom: initialZoom,
      pitch: 0, // Ортографический вид (глобус как круг)
      bearing: 0,
      renderWorldCopies: false,
      attributionControl: false,
      minZoom: initialZoom,
      maxZoom: initialZoom
    });

    await new Promise((resolve) => this.map.on('load', resolve));

    this.map.setTerrain(null);

    this.disableMapControls();

    this.preventWheelInterference();

    window.addEventListener('resize', () => {
      this.updateGlobeZoom();
      if (this._updateTargetZoom) {
        this._updateTargetZoom();
      }
    });

    this.preventAutoZoom();

    if (this.config.ENABLE_PROJECTION_FIX) {
      const tryFixProjectionScaler = () => {
        const fixed = this.fixProjectionScaler();
        if (!fixed) {
          setTimeout(() => {
            tryFixProjectionScaler();
          }, 100);
        }
      };

      requestAnimationFrame(() => {
        tryFixProjectionScaler();
      });

      this.map.once('idle', () => {
        requestAnimationFrame(() => {
          tryFixProjectionScaler();
        });
      });
    }

    this.geocodingService = new GeocodingService(mapboxgl.accessToken);

    this.countriesManager = new CountriesManager(this.map, this.config);
    this.countriesManager.loadFromDOM();
    this.countriesManager.highlightCountries();

    this.listFocusManager = new CountryListFocusManager(this, this.config, this.countriesManager);
    this.listFocusManager.init();

    this.officesManager = new OfficesManager(this.map, this.config, this.geocodingService);
    
    await this.waitForOfficeElements();
    
    await this.officesManager.loadFromDOM();
    this.officesManager.createMarkers();

    this.modalManager = new ModalManager(this.map, this.config);
    this.modalManager.init();
    
    this.officesManager.setModalManager(this.modalManager);

    this.tooltipManager = new TooltipManager(this.map, this.config, this.countriesManager);
    this.tooltipManager.init();

    this.setupScrollAnimation();

  }

  preventWheelInterference() {
    const container = document.getElementById(this.config.CONTAINER_ID);
    if (!container) return;

    const canvas = container.querySelector('.mapboxgl-canvas');
    if (!canvas) return;

    if (window.matchMedia) {
      if (!this._wheelInterferenceMediaQuery) {
        this._wheelInterferenceMediaQuery = window.matchMedia('(max-width: 991px)');

        const applyResponsiveMode = () => {
          if (this._wheelInterferenceMediaQuery.matches) {
            this.disableWheelInterferenceProtection(container, canvas);
            canvas.style.pointerEvents = 'auto';
          } else {
            this.enableWheelInterferenceProtection(container, canvas);
          }
        };

        applyResponsiveMode();

        if (typeof this._wheelInterferenceMediaQuery.addEventListener === 'function') {
          this._wheelInterferenceMediaQuery.addEventListener('change', applyResponsiveMode);
        } else if (typeof this._wheelInterferenceMediaQuery.addListener === 'function') {
          this._wheelInterferenceMediaQuery.addListener(applyResponsiveMode);
        }
      } else if (this._wheelInterferenceMediaQuery.matches) {
        this.disableWheelInterferenceProtection(container, canvas);
        canvas.style.pointerEvents = 'auto';
      } else {
        this.enableWheelInterferenceProtection(container, canvas);
      }

      return;
    }

    this.enableWheelInterferenceProtection(container, canvas);
  }

  enableWheelInterferenceProtection(container, canvas) {
    if (this.wheelInterferenceProtectionActive) {
      return;
    }

    this.wheelInterferenceProtectionActive = true;
    canvas.style.pointerEvents = 'none';

    let scrollTimeout = null;
    let isMouseOverMap = false;
    let isDragging = false;
    const SCROLL_DELAY_MS = 500; // 500ms

    const isContainerInViewport = () => {
      const rect = container.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    };

    const enablePointerEvents = () => {
      if (!isDragging) {
        canvas.style.pointerEvents = 'auto';
      }
    };

    const disablePointerEvents = () => {
      if (!isDragging) {
        canvas.style.pointerEvents = 'none';
      }
    };

    const resetScrollTimer = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
      }
      if (isMouseOverMap) {
        scrollTimeout = setTimeout(() => {
          enablePointerEvents();
          scrollTimeout = null;
        }, SCROLL_DELAY_MS);
      }
    };

    const onWheel = () => {
      disablePointerEvents();
      resetScrollTimer();
    };

    const onMouseEnter = () => {
      isMouseOverMap = true;
      if (!scrollTimeout) {
        resetScrollTimer();
      }
    };

    const onMouseLeave = () => {
      isMouseOverMap = false;
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
      }
      if (!isDragging) {
        disablePointerEvents();
      }
    };

    const onMouseDown = (e) => {
      if (e.button === 0) { // Левая кнопка мыши
        isDragging = true;
        canvas.style.pointerEvents = 'auto';
      }
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        if (!isMouseOverMap) {
          disablePointerEvents();
        } else {
          resetScrollTimer();
        }
      }
    };

    container.addEventListener('wheel', onWheel, { passive: true });
    container.addEventListener('mouseenter', onMouseEnter);
    container.addEventListener('mouseleave', onMouseLeave);
    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    if (isContainerInViewport()) {
      isMouseOverMap = true;
      resetScrollTimer();
    }

    this._wheelInterferenceCleanup = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
      }
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mouseenter', onMouseEnter);
      container.removeEventListener('mouseleave', onMouseLeave);
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  disableWheelInterferenceProtection(container, canvas) {
    if (!this.wheelInterferenceProtectionActive) {
      canvas.style.pointerEvents = 'auto';
      return;
    }

    if (typeof this._wheelInterferenceCleanup === 'function') {
      this._wheelInterferenceCleanup();
    }

    this._wheelInterferenceCleanup = null;
    this.wheelInterferenceProtectionActive = false;
    canvas.style.pointerEvents = 'auto';
  }

  setupScrollAnimation() {
    const container = document.getElementById(this.config.CONTAINER_ID);
    if (!container) {
      return;
    }

    let hasAnimated = false; // Флаг, чтобы анимация запускалась только один раз

    const targetCenter = this.config.INITIAL_CENTER;

    const observerOptions = {
      root: null, // Используем viewport как root
      rootMargin: '0px',
      threshold: 0.1 // Секция считается видимой, когда 10% её площади в viewport
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !hasAnimated) {
          hasAnimated = true;
          
          this.map.easeTo({
            center: targetCenter,
            duration: 1500, // Длительность анимации 1.5 секунды
            easing: (t) => {
              return t < 0.5
                ? 2 * t * t
                : -1 + (4 - 2 * t) * t;
            }
          });

          const initialLat = this.config.INITIAL_CENTER[1] + this.config.INITIAL_LATITUDE_OFFSET;
          
          observer.disconnect();
        }
      });
    }, observerOptions);

    observer.observe(container);

    const rect = container.getBoundingClientRect();
    const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
    
    if (isVisible && !hasAnimated) {
      setTimeout(() => {
        if (!hasAnimated) {
          hasAnimated = true;
          this.map.easeTo({
            center: targetCenter,
            duration: 1500,
            easing: (t) => {
              return t < 0.5
                ? 2 * t * t
                : -1 + (4 - 2 * t) * t;
            }
          });
          const initialLat = this.config.INITIAL_CENTER[1] + this.config.INITIAL_LATITUDE_OFFSET;
          observer.disconnect();
        }
      }, 300);
    }

  }

  async waitForOfficeElements() {
    const selector = '[' + this.config.ATTRIBUTES.OFFICE_ADDRESS + ']';
    const maxAttempts = 15;
    const checkInterval = 200;
    const mutationTimeout = 5000;

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      if (document.querySelectorAll(selector).length > 0) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    if (document.querySelectorAll(selector).length === 0) {
      await new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (document.querySelectorAll(selector).length > 0) {
            observer.disconnect();
            resolve();
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [this.config.ATTRIBUTES.OFFICE_ADDRESS]
        });

        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, mutationTimeout);
      });
    }
  }
}

class CountriesManager {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this.countries = [];
    this.geojsonData = null;
    this._geojsonLoadPromise = null;
    this._focusedCountryCode = null;
    this._listFocusedCountryCode = null;
    this._mapHoverFocusedCountryCode = null;
    this._featureIndexBuilt = false;
    this._featureByIsoA3 = new Map();
    this._featureByIsoA2 = new Map();
    this._featureByName = new Map();
  }

  loadFromDOM() {
    const items = document.querySelectorAll('[' + this.config.ATTRIBUTES.COUNTRY_ITEM + ']');
    this.countries = Array.from(items).map(item => ({
      name: item.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME),
      iso: item.getAttribute(this.config.ATTRIBUTES.COUNTRY_ISO)
    })).filter(country => country.iso); // Фильтруем страны без ISO кода

    return this.countries;
  }

  highlightCountries() {
    if (this.countries.length === 0) {
      return;
    }

    const countryISOs = this.countries.map(c => c.iso).filter(Boolean).map(normalizeIsoCode);
    const countryIsoA3s = countryISOs.filter((code) => code.length === 3);
    const countryIsoA2s = countryISOs.filter((code) => code.length === 2);

    ['highlighted-countries', 'highlighted-countries-stroke'].forEach(layerId => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });

    const countriesGeoJSONSourceId = 'countries-geojson';

    if (!this.map.getSource(countriesGeoJSONSourceId)) {
      this.map.addSource(countriesGeoJSONSourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        },
        tolerance: 0
      });

      this._geojsonLoadPromise = this.loadHighDetailGeoJSON(countriesGeoJSONSourceId, countryISOs);
    }

    const layerConfig = {
      id: 'highlighted-countries',
      type: 'fill',
      source: countriesGeoJSONSourceId,
      filter: [
        'any',
        ['in', ['get', 'adm0_a3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ADM0_A3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ISO_A3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'iso_a3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ISO_A2'], ['literal', countryIsoA2s]],
        ['in', ['get', 'iso_a2'], ['literal', countryIsoA2s]]
      ],
      paint: {
        'fill-color': this.config.COUNTRY_COLOR,
        'fill-opacity': this.config.COUNTRY_FILL_OPACITY
      }
    };

    const strokeLayerConfig = {
      id: 'highlighted-countries-stroke',
      type: 'line',
      source: countriesGeoJSONSourceId,
      filter: [
        'any',
        ['in', ['get', 'adm0_a3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ADM0_A3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ISO_A3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'iso_a3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ISO_A2'], ['literal', countryIsoA2s]],
        ['in', ['get', 'iso_a2'], ['literal', countryIsoA2s]]
      ],
      paint: {
        'line-color': this.config.COUNTRY_STROKE_COLOR,
        'line-width': this.config.COUNTRY_STROKE_WIDTH,
        'line-opacity': 0.8
      }
    };

    try {
      const adminCountryLayer = this.map.getLayer('admin-country');
      const beforeLayer = adminCountryLayer ? 'admin-country' : undefined;
      this.map.addLayer(layerConfig, beforeLayer);

      this.map.addLayer(strokeLayerConfig, beforeLayer);

    } catch (error) {
      throw error;
    }
  }

  waitForGeoJSON() {
    if (this.geojsonData) {
      this.buildFeatureIndex();
      return Promise.resolve(this.geojsonData);
    }
    if (this._geojsonLoadPromise) {
      return this._geojsonLoadPromise.then(() => {
        this.buildFeatureIndex();
        return this.geojsonData;
      });
    }
    return Promise.resolve(null);
  }

  normalizeString(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  buildFeatureIndex() {
    if (this._featureIndexBuilt) return;
    if (!this.geojsonData?.features?.length) return;

    this._featureByIsoA3.clear();
    this._featureByIsoA2.clear();
    this._featureByName.clear();

    for (const feature of this.geojsonData.features) {
      const props = feature?.properties || {};

      const isoA3 = normalizeIsoCode(
        props.adm0_a3 || props.ADM0_A3 || props.ISO_A3 || props.iso_a3 || ''
      );
      const isoA2 = normalizeIsoCode(props.ISO_A2 || props.iso_a2 || '');
      const name = normalizeCountryName(props.name_en || props.NAME_EN || props.name || props.NAME || '');

      if (isoA3 && isoA3.length === 3 && !this._featureByIsoA3.has(isoA3)) {
        this._featureByIsoA3.set(isoA3, feature);
      }
      if (isoA2 && isoA2.length === 2 && !this._featureByIsoA2.has(isoA2)) {
        this._featureByIsoA2.set(isoA2, feature);
      }
      if (name && !this._featureByName.has(name)) {
        this._featureByName.set(name, feature);
      }
    }

    this._featureIndexBuilt = true;
  }

  findCountryFeature({ iso, name }) {
    if (!this.geojsonData?.features?.length) return null;

    const normalizedIso = normalizeIsoCode(iso);

    if (normalizedIso) {
      const byA3 = this._featureByIsoA3.get(normalizedIso);
      if (byA3) return byA3;

      const byA2 = this._featureByIsoA2.get(normalizedIso);
      if (byA2) return byA2;
    }

    const matchesIso = (props) => {
      if (!normalizedIso) return false;
      const candidates = [
        props.adm0_a3,
        props.ADM0_A3,
        props.ISO_A3,
        props.iso_a3,
        props.ISO_A2,
        props.iso_a2
      ];
      return candidates.some((candidate) => normalizeIsoCode(candidate) === normalizedIso);
    };

    for (const feature of this.geojsonData.features) {
      const props = feature?.properties || {};
      if (matchesIso(props)) {
        return feature;
      }
    }

    return null;
  }

  getFeatureFocusCode(feature) {
    const props = feature?.properties || {};
    return props.adm0_a3 || props.ADM0_A3 || props.ISO_A3 || props.iso_a3 || props.ISO_A2 || props.iso_a2 || null;
  }

  getPolygonCenter(coords) {
    const computeBboxCenter = (ring) => {
      let minLng = Infinity, maxLng = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;

      for (const point of ring || []) {
        if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') continue;
        minLng = Math.min(minLng, point[0]);
        maxLng = Math.max(maxLng, point[0]);
        minLat = Math.min(minLat, point[1]);
        maxLat = Math.max(maxLat, point[1]);
      }

      if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
      return {
        center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
        bboxArea: Math.max(0, (maxLng - minLng) * (maxLat - minLat))
      };
    };

    const isRing = (value) => {
      if (!Array.isArray(value) || value.length === 0) return false;
      const first = value[0];
      return Array.isArray(first) && typeof first[0] === 'number' && typeof first[1] === 'number';
    };

    const collectRings = (value, out) => {
      if (!Array.isArray(value)) return;
      if (isRing(value)) {
        out.push(value);
        return;
      }
      for (const item of value) {
        collectRings(item, out);
      }
    };

    const rings = [];
    collectRings(coords, rings);

    if (rings.length) {
      let best = null;
      for (const ring of rings) {
        const bbox = computeBboxCenter(ring);
        if (!bbox) continue;
        if (!best || bbox.bboxArea > best.bboxArea) {
          best = bbox;
        }
      }
      if (best?.center) return best.center;
    }

    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    const flatten = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (Array.isArray(item?.[0])) {
          flatten(item);
        } else if (Array.isArray(item) && typeof item[0] === 'number' && typeof item[1] === 'number') {
          minLng = Math.min(minLng, item[0]);
          maxLng = Math.max(maxLng, item[0]);
          minLat = Math.min(minLat, item[1]);
          maxLat = Math.max(maxLat, item[1]);
        }
      }
    };

    flatten(coords);

    if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;

    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  }

  async resolveFocusTarget({ iso, name }) {
    if (!iso) return null;
    await this.waitForGeoJSON();

    const feature = this.findCountryFeature({ iso });
    if (this.config.DEBUG_LOGS) {
      console.debug('[Map] resolve focus', { iso, featureFound: !!feature });
    }
    if (!feature) return null;

    const center = this.getPolygonCenter(feature.geometry?.coordinates);
    if (!center) return null;

    const focusCode = this.getFeatureFocusCode(feature);

    return { center, focusCode };
  }

  setFocusedCountry(focusCode, source = 'list') {
    const normalized = focusCode || null;

    if (source === 'mapHover') {
      this._mapHoverFocusedCountryCode = normalized;
    } else {
      this._listFocusedCountryCode = normalized;
    }

    this._focusedCountryCode = this._mapHoverFocusedCountryCode || this._listFocusedCountryCode || null;

    const fillLayerId = 'highlighted-countries';
    if (!this.map.getLayer(fillLayerId)) return;

    if (!this._focusedCountryCode) {
      this.map.setPaintProperty(fillLayerId, 'fill-color', this.config.COUNTRY_COLOR);
      return;
    }

    const code = this._focusedCountryCode;
    const focusedExpression = [
      'case',
      [
        'any',
        ['==', ['get', 'adm0_a3'], code],
        ['==', ['get', 'ADM0_A3'], code],
        ['==', ['get', 'ISO_A3'], code],
        ['==', ['get', 'iso_a3'], code],
        ['==', ['get', 'ISO_A2'], code],
        ['==', ['get', 'iso_a2'], code]
      ],
      this.config.COUNTRY_FOCUS_COLOR,
      this.config.COUNTRY_COLOR
    ];

    this.map.setPaintProperty(fillLayerId, 'fill-color', focusedExpression);
  }

  async loadHighDetailGeoJSON(sourceId, countryISOs) {
    const normalizedCountryISOs = (countryISOs || []).map(normalizeIsoCode);
    const countryIsoA3s = normalizedCountryISOs.filter((code) => code.length === 3);
    const countryIsoA2s = normalizedCountryISOs.filter((code) => code.length === 2);

    const sources = [
      'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_10m_admin_0_countries.geojson',
      'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_countries.geojson',
      'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson',
      'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson'
    ];

    let loaded = false;

    for (const url of sources) {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          continue;
        }

        let data = await response.json();

        if (data.type === 'Topology' && data.objects) {
          try {
            continue;
          } catch (e) {
            continue;
          }
        }

        if (data.type !== 'FeatureCollection') {
          if (data.features) {
            data = { type: 'FeatureCollection', features: data.features };
          } else {
            continue;
          }
        }

        data.features = data.features.map(feature => {
          const props = feature.properties || {};

          const isoA3 = props.adm0_a3 || props.ISO_A3 || props.iso_a3 || props.ADM0_A3;

          if (isoA3) {
            props.adm0_a3 = isoA3;
          }

          return feature;
        });

        const countCoords = (coords) => {
          if (!Array.isArray(coords) || coords.length === 0) return 0;
          if (typeof coords[0] === 'number') {
            return coords.length / 2; // Каждая координата = 2 числа
          }
          return coords.reduce((sum, c) => sum + countCoords(c), 0);
        };

        const totalCoordinates = data.features.reduce((total, feature) => {
          return total + (feature.geometry?.coordinates ? countCoords(feature.geometry.coordinates) : 0);
        }, 0);

        const isHighDetail = totalCoordinates >= this.config.MIN_COORDINATES_THRESHOLD;

        if (!isHighDetail && sources.indexOf(url) < sources.length - 1) {
          continue;
        }

        const source = this.map.getSource(sourceId);
        source.setData(data);
        this.geojsonData = data;
        this._featureIndexBuilt = false;

        const countryFilter = [
          'any',
          ['in', ['get', 'adm0_a3'], ['literal', countryIsoA3s]],
          ['in', ['get', 'ADM0_A3'], ['literal', countryIsoA3s]],
          ['in', ['get', 'ISO_A3'], ['literal', countryIsoA3s]],
          ['in', ['get', 'iso_a3'], ['literal', countryIsoA3s]],
          ['in', ['get', 'ISO_A2'], ['literal', countryIsoA2s]],
          ['in', ['get', 'iso_a2'], ['literal', countryIsoA2s]]
        ];
        ['highlighted-countries', 'highlighted-countries-stroke'].forEach(layerId => {
          if (this.map.getLayer(layerId)) {
            this.map.setFilter(layerId, countryFilter);
          }
        });

        loaded = true;
        break;

      } catch (error) {
        continue;
      }
    }

    if (!loaded) {
      await this.loadFallbackGeoJSON(sourceId, countryISOs);
    }
  }

  async loadFallbackGeoJSON(sourceId, countryISOs) {
    try {
      const response = await fetch(this.config.COUNTRIES_GEOJSON_URL);
      const data = await response.json();

      const nameToISO = {
        'Lithuania': 'LT', 'Belarus': 'BY', 'Czech Republic': 'CZ', 'Hungary': 'HU',
        'Netherlands': 'NL', 'Austria': 'AT', 'Slovakia': 'SK', 'Slovenia': 'SI',
        'Croatia': 'HR', 'Portugal': 'PT', 'Italy': 'IT', 'Spain': 'ES',
        'Ukraine': 'UA', 'Latvia': 'LV', 'Estonia': 'EE', 'Germany': 'DE', 'Poland': 'PL'
      };

      data.features = data.features.map(feature => {
        const name = feature.properties?.name || feature.properties?.NAME;
        if (name && !feature.properties.ISO_A2) {
          feature.properties.ISO_A2 = nameToISO[name] || null;
        }
        return feature;
      });

      this.map.getSource(sourceId).setData(data);
      this.geojsonData = data;
      this._featureIndexBuilt = false;

      const normalizedCountryISOs = (countryISOs || []).map(normalizeIsoCode);
      const countryIsoA3s = normalizedCountryISOs.filter((code) => code.length === 3);
      const countryIsoA2s = normalizedCountryISOs.filter((code) => code.length === 2);
      const fallbackFilter = [
        'any',
        ['in', ['get', 'adm0_a3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ADM0_A3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ISO_A3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'iso_a3'], ['literal', countryIsoA3s]],
        ['in', ['get', 'ISO_A2'], ['literal', countryIsoA2s]],
        ['in', ['get', 'iso_a2'], ['literal', countryIsoA2s]]
      ];
      ['highlighted-countries', 'highlighted-countries-stroke'].forEach(layerId => {
        if (this.map.getLayer(layerId)) {
          this.map.setFilter(layerId, fallbackFilter);
        }
      });

    } catch (error) {
    }
  }
}

class CountryListFocusManager {
  constructor(controller, config, countriesManager) {
    this.controller = controller;
    this.map = controller.map;
    this.config = config;
    this.countriesManager = countriesManager;
    this._hoveredItem = null;
    this._focusTimer = null;
    this._unfocusTimer = null;
    this._sequence = 0;
    this._lastFocusKey = null;
    this._onPointerOver = null;
    this._onPointerOut = null;
    this._mobileMediaQuery = null;
  }

  isMobileLayout() {
    if (window.matchMedia) {
      return window.matchMedia('(max-width: 991px)').matches;
    }
    return window.innerWidth <= 991;
  }

  init() {
    const applyMode = () => {
      if (this.isMobileLayout()) {
        this.detach();
        this.clearFocus();
      } else {
        this.attach();
      }
    };

    applyMode();

    if (window.matchMedia) {
      this._mobileMediaQuery = window.matchMedia('(max-width: 991px)');
      if (typeof this._mobileMediaQuery.addEventListener === 'function') {
        this._mobileMediaQuery.addEventListener('change', applyMode);
      } else if (typeof this._mobileMediaQuery.addListener === 'function') {
        this._mobileMediaQuery.addListener(applyMode);
      }
    }
  }

  attach() {
    if (this._onPointerOver || this._onPointerOut) return;

    this._onPointerOver = (e) => {
      const item = e.target?.closest?.('[' + this.config.ATTRIBUTES.LIST_ITEM + ']');
      if (!item) return;
      if (this._hoveredItem === item) return;

      this._hoveredItem = item;
      this.scheduleFocus(item);
    };

    this._onPointerOut = (e) => {
      const item = e.target?.closest?.('[' + this.config.ATTRIBUTES.LIST_ITEM + ']');
      if (!item) return;
      if (item.contains(e.relatedTarget)) return;

      if (this._hoveredItem === item) {
        this._hoveredItem = null;
      }
      this.scheduleUnfocus();
    };

    document.addEventListener('pointerover', this._onPointerOver, true);
    document.addEventListener('pointerout', this._onPointerOut, true);
  }

  detach() {
    if (this._onPointerOver) {
      document.removeEventListener('pointerover', this._onPointerOver, true);
      this._onPointerOver = null;
    }
    if (this._onPointerOut) {
      document.removeEventListener('pointerout', this._onPointerOut, true);
      this._onPointerOut = null;
    }
    this.clearTimers();
  }

  clearTimers() {
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }
    if (this._unfocusTimer) {
      clearTimeout(this._unfocusTimer);
      this._unfocusTimer = null;
    }
  }

  scheduleFocus(item) {
    this.clearTimers();
    this._sequence += 1;
    const sequence = this._sequence;

    this._focusTimer = setTimeout(async () => {
      if (sequence !== this._sequence) return;
      if (!item || item !== this._hoveredItem) return;

      const focus = this.getFocusFromItem(item);
<<<<<<< ours
<<<<<<< ours
      const focusKey = focus.iso || '';
      if (!focus.iso) return;
=======
=======
>>>>>>> theirs
      const focusKey = (focus.iso || '') + '::' + (focus.name || '');
      if (!focus.iso && !focus.name) return;
>>>>>>> theirs
      if (focusKey === this._lastFocusKey) return;

      if (this.config.DEBUG_LOGS) {
        console.debug('[Map] list focus start', { iso: focus.iso });
      }
      const target = await this.countriesManager.resolveFocusTarget(focus);
      if (sequence !== this._sequence) return;
      if (!target) return;

      this._lastFocusKey = focusKey;
      if (this.config.DEBUG_LOGS) {
        console.debug('[Map] list focus target', { iso: focus.iso, focusCode: target.focusCode, center: target.center });
      }
      this.countriesManager.setFocusedCountry(target.focusCode, 'list');

      const containerRect = this.map.getContainer()?.getBoundingClientRect?.();
      const containerHeight = containerRect?.height || 0;
      const offsetY = -containerHeight * (this.config.LIST_FOCUS_OFFSET_Y_RATIO || 0);

      this.controller.easeToCamera({
        center: target.center,
        offset: [0, offsetY],
        duration: this.config.LIST_FOCUS_ANIMATION_DURATION_MS,
        easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      });
    }, this.config.LIST_HOVER_FOCUS_DELAY_MS);
  }

  scheduleUnfocus() {
    this.clearTimers();
    this._sequence += 1;
    const sequence = this._sequence;

    this._unfocusTimer = setTimeout(() => {
      if (sequence !== this._sequence) return;
      if (this._hoveredItem) return;
      this.clearFocus();
    }, this.config.LIST_HOVER_UNFOCUS_DELAY_MS);
  }

  clearFocus() {
    this._lastFocusKey = null;
    this.countriesManager.setFocusedCountry(null, 'list');
  }

  getFocusFromItem(item) {
    const iso =
      item.getAttribute(this.config.ATTRIBUTES.COUNTRY_ISO) ||
      item.querySelector?.('[' + this.config.ATTRIBUTES.COUNTRY_ISO + ']')?.getAttribute(this.config.ATTRIBUTES.COUNTRY_ISO) ||
      item.querySelector?.('[' + this.config.ATTRIBUTES.COUNTRY_ITEM + ']')?.getAttribute(this.config.ATTRIBUTES.COUNTRY_ISO) ||
      null;
<<<<<<< ours
    if (!iso && this.config.DEBUG_LOGS) {
      console.debug('[Map] list item missing ISO', { item });
    }
    return { iso, name: null };
=======

    const name =
      item.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME) ||
      item.querySelector?.('[' + this.config.ATTRIBUTES.COUNTRY_NAME + ']')?.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME) ||
      item.querySelector?.('[' + this.config.ATTRIBUTES.COUNTRY_ITEM + ']')?.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME) ||
      item.textContent?.trim() ||
      null;

    return { iso, name };
>>>>>>> theirs
  }
}

class GeocodingService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.cache = new Map();
  }

  async geocodeAddress(address) {
    const trimmedAddress = address.trim();
    
    if (this.cache.has(trimmedAddress)) {
      return this.cache.get(trimmedAddress);
    }

    const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(trimmedAddress) + '.json';
    const response = await fetch(url + '?access_token=' + this.accessToken);

    if (!response.ok) {
      throw new Error('Geocoding failed: ' + response.statusText);
    }

    const data = await response.json();
    const coordinates = data.features?.[0]?.center;

    if (!coordinates) {
      throw new Error('No results for address: ' + trimmedAddress);
    }

    this.cache.set(trimmedAddress, coordinates);
    return coordinates;
  }
}

class OfficesManager {
  constructor(map, config, geocodingService) {
    this.map = map;
    this.config = config;
    this.geocodingService = geocodingService;
    this.offices = [];
    this.markers = [];
  }

  async loadFromDOM() {
    const selector = '[' + this.config.ATTRIBUTES.OFFICE_ADDRESS + ']';
    const items = document.querySelectorAll(selector);

    for (const pinElement of items) {
      const address = pinElement.getAttribute(this.config.ATTRIBUTES.OFFICE_ADDRESS);

      if (!address || address.trim() === '') {
        continue;
      }

      const officeItem = pinElement.closest('[' + this.config.ATTRIBUTES.OFFICE_ITEM + ']');

      try {
        const coordinates = await this.geocodingService.geocodeAddress(address.trim());

        this.offices.push({
          address: address.trim(),
          coordinates: coordinates,
          pinElement: pinElement, // Сохраняем элемент пина для создания маркера
          officeItem: officeItem // Сохраняем элемент Collection List item для модального окна
        });
      } catch (error) {
      }
    }

    return this.offices;
  }

  createMarkers() {
    if (this.offices.length === 0) {
      return;
    }

    this.offices.forEach((office, index) => {
      if (!office.pinElement) {
        return;
      }

      const pinElement = office.pinElement.cloneNode(true);
      pinElement.style.display = 'block';
      pinElement.removeAttribute(this.config.ATTRIBUTES.OFFICE_ADDRESS);

      try {
        const marker = new mapboxgl.Marker(pinElement);
        marker.setLngLat(office.coordinates);
        marker.addTo(this.map);

        pinElement.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onMarkerClick(office, marker);
        });

        this.markers.push({ marker, office });
      } catch (error) {
      }
    });

  }

  onMarkerClick(office, marker) {
    if (this.modalManager) {
      const markerElement = marker.getElement();
      const markerRect = markerElement.getBoundingClientRect();
      const markerPosition = {
        x: markerRect.left + markerRect.width / 2,
        y: markerRect.top + markerRect.height / 2
      };
      
      this.modalManager.show(office, markerPosition);
    }
  }

  setModalManager(modalManager) {
    this.modalManager = modalManager;
  }
}

class ModalManager {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this.currentModal = null;
    this.currentCloseButton = null;
    this.isOpen = false;
    this._lastMarkerPosition = null;
    this._mobileMediaQuery = null;
  }

  isMobileLayout() {
    if (window.matchMedia) {
      return window.matchMedia('(max-width: 991px)').matches;
    }
    return window.innerWidth <= 991;
  }

  ensureContainerPositioned(container) {
    if (!container) return;

    const computedPosition = window.getComputedStyle(container).position;
    if (computedPosition === 'static') {
      container.style.position = 'relative';
    }
  }

  relayoutOpenModal() {
    if (!this.isOpen || !this.currentModal) return;

    const modal = this.currentModal;
    const mapContainer = document.getElementById(this.config.CONTAINER_ID) || this.map.getContainer();
    const useMobileLayout = this.isMobileLayout();

    if (useMobileLayout) {
      if (mapContainer) {
        this.ensureContainerPositioned(mapContainer);
        if (modal.parentNode !== mapContainer) {
          mapContainer.appendChild(modal);
        }
      }
    } else if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }

    this.positionModal(modal, this._lastMarkerPosition);
  }

  init() {
    this.map.on('click', (e) => {
      if (this.isOpen) {
        const clickedElement = e.originalEvent?.target;
        const isModalClick = clickedElement && (
          clickedElement.closest('[' + this.config.ATTRIBUTES.MODAL + ']') === this.currentModal
        );
        
        const isMarkerClick = clickedElement && clickedElement.closest('.mapboxgl-marker');
        
        if (!isModalClick && !isMarkerClick) {
          this.close();
        }
      }
    });

    if (window.matchMedia) {
      this._mobileMediaQuery = window.matchMedia('(max-width: 991px)');
      const onChange = () => this.relayoutOpenModal();
      if (typeof this._mobileMediaQuery.addEventListener === 'function') {
        this._mobileMediaQuery.addEventListener('change', onChange);
      } else if (typeof this._mobileMediaQuery.addListener === 'function') {
        this._mobileMediaQuery.addListener(onChange);
      }
    }

    window.addEventListener('resize', () => this.relayoutOpenModal(), { passive: true });
  }

  show(office, markerPosition) {
    if (!office || !office.officeItem) {
      return;
    }

    let modal = document.querySelector('[' + this.config.ATTRIBUTES.MODAL + '][data-office-address=\"' + office.address + '\"]');
    
    if (!modal) {
      modal = office.officeItem.querySelector('[' + this.config.ATTRIBUTES.MODAL + ']');
    }
    
    if (!modal) {
      return;
    }
    
    if (!modal.hasAttribute('data-office-address')) {
      modal.setAttribute('data-office-address', office.address);
    }

    if (this.isOpen && this.currentModal !== modal) {
      this.close();
    }

    this.currentModal = modal;
    this._lastMarkerPosition = markerPosition;

    const closeButton = modal.querySelector('[' + this.config.ATTRIBUTES.MODAL_CLOSE + ']');
    
    if (closeButton) {
      this.currentCloseButton = closeButton;
      
      const newCloseButton = closeButton.cloneNode(true);
      closeButton.parentNode.replaceChild(newCloseButton, closeButton);
      
      newCloseButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
      
      this.currentCloseButton = newCloseButton;
    }

    this.populateModalContent(modal, office);

    if (!modal._originalParent) {
      const originalParent = modal.parentNode;
      const originalNextSibling = modal.nextSibling;
      
      modal._originalParent = originalParent;
      modal._originalNextSibling = originalNextSibling;
    }

    const mapContainer = document.getElementById(this.config.CONTAINER_ID) || this.map.getContainer();
    const useMobileLayout = this.isMobileLayout();

    if (useMobileLayout) {
      if (mapContainer) {
        this.ensureContainerPositioned(mapContainer);
        if (modal.parentNode !== mapContainer) {
          mapContainer.appendChild(modal);
        }
      }
    } else if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    
    let originalDisplay = 'flex'; // Значение по умолчанию из CSS класса
    if (modal.style.display === 'none' || window.getComputedStyle(modal).display === 'none') {
      const tempDisplay = modal.style.display;
      modal.style.display = '';
      originalDisplay = window.getComputedStyle(modal).display || 'flex';
      modal.style.display = tempDisplay; // Возвращаем обратно
    } else {
      originalDisplay = window.getComputedStyle(modal).display || 'flex';
    }
    
    modal.style.display = 'none'; // Временно скрываем для правильного позиционирования
    modal.style.zIndex = '10000'; // Устанавливаем высокий z-index для отображения поверх карты

    this.positionModal(modal, markerPosition);
    
    modal.style.display = originalDisplay;

    this.map.dragPan.disable();
    this.isOpen = true;

  }

  populateModalContent(modal, office) {
    const { officeItem } = office;
    const fieldMappings = [
      {
        attr: this.config.ATTRIBUTES.OFFICE_NAME,
        handler: (element, value) => {
          if (value) element.textContent = value;
        },
        getValue: () => officeItem.querySelector('[' + this.config.ATTRIBUTES.OFFICE_NAME + ']')?.textContent?.trim()
      },
      {
        attr: this.config.ATTRIBUTES.OFFICE_DESCRIPTION,
        handler: (element, value) => {
          if (value) element.innerHTML = value;
        },
        getValue: () => officeItem.querySelector('[' + this.config.ATTRIBUTES.OFFICE_DESCRIPTION + ']')?.innerHTML?.trim()
      },
      {
        attr: this.config.ATTRIBUTES.OFFICE_PHONE,
        handler: (element, value) => {
          if (value) {
            element.textContent = value;
            if (element.tagName === 'A') {
              element.href = 'tel:' + value;
            }
          }
        },
        getValue: () => officeItem.getAttribute(this.config.ATTRIBUTES.OFFICE_PHONE) || 
                       officeItem.querySelector('[' + this.config.ATTRIBUTES.OFFICE_PHONE + ']')?.textContent?.trim()
      },
      {
        attr: this.config.ATTRIBUTES.OFFICE_EMAIL,
        handler: (element, value) => {
          if (value) {
            element.textContent = value;
            if (element.tagName === 'A') {
              element.href = 'mailto:' + value;
            }
          }
        },
        getValue: () => officeItem.getAttribute(this.config.ATTRIBUTES.OFFICE_EMAIL) || 
                       officeItem.querySelector('[' + this.config.ATTRIBUTES.OFFICE_EMAIL + ']')?.textContent?.trim()
      },
      {
        attr: this.config.ATTRIBUTES.OFFICE_LINK,
        handler: (element, value) => {
          if (value) {
            if (element.tagName === 'A') {
              element.href = value;
              element.target = '_blank';
            } else {
              element.textContent = value;
            }
          }
        },
        getValue: () => officeItem.getAttribute(this.config.ATTRIBUTES.OFFICE_LINK) || 
                       officeItem.querySelector('[' + this.config.ATTRIBUTES.OFFICE_LINK + ']')?.getAttribute('href')
      }
    ];

    fieldMappings.forEach(({ attr, handler, getValue }) => {
      const element = modal.querySelector('[' + attr + ']');
      if (element) {
        handler(element, getValue());
      }
    });
  }

  positionModal(modal, markerPosition) {
    if (this.isMobileLayout()) {
      Object.assign(modal.style, {
        position: 'absolute',
        left: '50%',
        right: '',
        bottom: '3.5em',
        top: '',
        zIndex: '10000',
        width: 'calc(100vw - (var(--grid--grid-margin-left) + var(--grid--grid-margin-right)))',
        maxWidth: 'calc(100vw - (var(--grid--grid-margin-left) + var(--grid--grid-margin-right)))',
        transform: 'translateX(-50%)'
      });
      return;
    }

    if (!markerPosition) {
      return;
    }

    const isScreenCoords = typeof markerPosition === 'object' && 
                          !Array.isArray(markerPosition) && 
                          markerPosition.x !== undefined;
    
    let absoluteX, absoluteY;
    
    if (isScreenCoords) {
      ({ x: absoluteX, y: absoluteY } = markerPosition);
    } else {
      const point = this.map.project(markerPosition);
      const containerRect = this.map.getContainer().getBoundingClientRect();
      absoluteX = containerRect.left + point.x;
      absoluteY = containerRect.top + point.y;
    }
    
    const fontSize = parseFloat(window.getComputedStyle(document.body).fontSize) || 16;
    const offsetPx = 1.25 * fontSize;
    
    Object.assign(modal.style, {
      position: 'fixed',
      left: (absoluteX + offsetPx) + 'px',
      top: absoluteY + 'px',
      right: '',
      bottom: '',
      width: '',
      maxWidth: '',
      transform: '',
      zIndex: '10000'
    });
  }

  close() {
    if (this.currentModal) {
      this.currentModal.style.display = 'none';
      
      this.currentModal.style.position = '';
      this.currentModal.style.left = '';
      this.currentModal.style.right = '';
      this.currentModal.style.top = '';
      this.currentModal.style.bottom = '';
      this.currentModal.style.width = '';
      this.currentModal.style.maxWidth = '';
      this.currentModal.style.transform = '';
      this.currentModal.style.zIndex = '';
      
      if (this.currentModal._originalParent && this.currentModal._originalNextSibling) {
        if (this.currentModal._originalParent.parentNode || document.body.contains(this.currentModal._originalParent)) {
          if (this.currentModal._originalNextSibling.parentNode) {
            this.currentModal._originalNextSibling.parentNode.insertBefore(
              this.currentModal,
              this.currentModal._originalNextSibling
            );
          } else if (this.currentModal._originalParent) {
            this.currentModal._originalParent.appendChild(this.currentModal);
          }
        }
      }
    }

    this.map.dragPan.enable();
    this.isOpen = false;
    this.currentModal = null;
    this.currentCloseButton = null;
    this._lastMarkerPosition = null;

  }
}

class TooltipManager {
  constructor(map, config, countriesManager) {
    this.map = map;
    this.config = config;
    this.countriesManager = countriesManager || null;
    this.tooltip = null;
    this.tooltipTemplate = null;
    this._hoverEnabled = false;
    this._mobileMediaQuery = null;
    this._onMouseMove = null;
    this._onMouseLeave = null;
    this._onScroll = null;
    this._countryItemIndexBuilt = false;
    this._countryItemByIso = new Map();
    this._countryItemByName = new Map();
    this._lastHoverFocusCode = null;
  }

  isMobileLayout() {
    if (window.matchMedia) {
      return window.matchMedia('(max-width: 991px)').matches;
    }
    return window.innerWidth <= 991;
  }

  init() {
    const tooltipInCollection = document.querySelector('[' + this.config.ATTRIBUTES.COUNTRY_ITEM + '] [' + this.config.ATTRIBUTES.TOOLTIP + ']');
    
    if (tooltipInCollection) {
      this.tooltipTemplate = tooltipInCollection;
      
      this.tooltip = tooltipInCollection.cloneNode(true);
      
      this.tooltip.removeAttribute(this.config.ATTRIBUTES.TOOLTIP);
      
      document.body.appendChild(this.tooltip);
      
    } else {
      this.tooltip = document.querySelector('[' + this.config.ATTRIBUTES.TOOLTIP + ']');
      
      if (this.tooltip) {
      }
    }

    if (!this.tooltip) {
      return;
    }

    if (this.tooltip.style.position !== 'fixed' && this.tooltip.style.position !== 'absolute') {
      this.tooltip.style.position = 'fixed';
    }
    this.tooltip.style.pointerEvents = 'none';
    this.tooltip.style.zIndex = '9999';
    this.tooltip.style.display = 'none';

    const applyMode = () => {
      if (this.isMobileLayout()) {
        this.disableHover();
      } else {
        this.enableHover();
      }
    };

    applyMode();

    if (window.matchMedia) {
      this._mobileMediaQuery = window.matchMedia('(max-width: 991px)');
      if (typeof this._mobileMediaQuery.addEventListener === 'function') {
        this._mobileMediaQuery.addEventListener('change', applyMode);
      } else if (typeof this._mobileMediaQuery.addListener === 'function') {
        this._mobileMediaQuery.addListener(applyMode);
      }
    }

  }

  enableHover() {
    if (this._hoverEnabled) return;
    this._hoverEnabled = true;
    this.setupMapHover();
  }

  disableHover() {
    if (!this._hoverEnabled) {
      this.hide();
      return;
    }

    if (this._onMouseMove) {
      this.map.off('mousemove', this._onMouseMove);
    }
    if (this._onMouseLeave) {
      this.map.off('mouseleave', this._onMouseLeave);
    }
    if (this._onScroll) {
      window.removeEventListener('scroll', this._onScroll, { passive: true });
    }

    this._onMouseMove = null;
    this._onMouseLeave = null;
    this._onScroll = null;
    this._hoverEnabled = false;
    this.hide();
  }

  findCountryItemByName(geoJsonCountryName) {
    if (!geoJsonCountryName) return null;

    if (!this._countryItemIndexBuilt) {
      this.buildCountryItemIndex();
    }
    
    const countryItems = document.querySelectorAll('[' + this.config.ATTRIBUTES.COUNTRY_ITEM + ']');
    
    const normalizedGeoJsonName = normalizeCountryName(geoJsonCountryName);
    
    for (const item of countryItems) {
      const countryName = item.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME);
      
      if (!countryName) continue;
      
      const normalizedCollectionName = normalizeCountryName(countryName);
      
      if (normalizedCollectionName === normalizedGeoJsonName) {
        return item;
      }
      
      if (normalizedCollectionName.includes(normalizedGeoJsonName) || 
          normalizedGeoJsonName.includes(normalizedCollectionName)) {
        return item;
      }
    }
    
    return null;
  }

  buildCountryItemIndex() {
    this._countryItemByIso.clear();
    this._countryItemByName.clear();

    const countryItems = document.querySelectorAll('[' + this.config.ATTRIBUTES.COUNTRY_ITEM + ']');
    for (const item of countryItems) {
    const iso =
      item.getAttribute(this.config.ATTRIBUTES.COUNTRY_ISO) ||
      item.querySelector?.('[' + this.config.ATTRIBUTES.COUNTRY_ISO + ']')?.getAttribute(this.config.ATTRIBUTES.COUNTRY_ISO) ||
      null;
      const name = item.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME) || null;

      const normalizedIso = normalizeIsoCode(iso);
      const normalizedName = normalizeCountryName(name);

      if (normalizedIso && !this._countryItemByIso.has(normalizedIso)) {
        this._countryItemByIso.set(normalizedIso, item);
      }
      if (normalizedName && !this._countryItemByName.has(normalizedName)) {
        this._countryItemByName.set(normalizedName, item);
      }
    }

    this._countryItemIndexBuilt = true;
  }

  findCountryItem({ iso, name }) {
    if (!this._countryItemIndexBuilt) {
      this.buildCountryItemIndex();
    }

    const normalizedIso = normalizeIsoCode(iso);
    if (normalizedIso) {
      const byIso = this._countryItemByIso.get(normalizedIso);
      if (this.config.DEBUG_LOGS) {
        console.debug('[Map] tooltip lookup by ISO', { iso: normalizedIso, found: !!byIso });
      }
      if (byIso) return byIso;
    }
    if (this.config.DEBUG_LOGS) {
      console.debug('[Map] tooltip lookup missing ISO', { iso: normalizedIso, name });
    }
    return null;
  }

  getMouseCoordinates(e) {
    if (e.originalEvent) {
      return {
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY
      };
    }
    
    const container = this.map.getContainer();
    const rect = container.getBoundingClientRect();
    return {
      x: rect.left + e.point.x,
      y: rect.top + e.point.y
    };
  }

  getCountryNameFromProperties(properties) {
    return properties.name_en || properties.NAME || properties.name || properties.NAME_EN || null;
  }

  getCountryIsoFromProperties(properties) {
    return (
      properties.adm0_a3 ||
      properties.ADM0_A3 ||
      properties.ISO_A3 ||
      properties.iso_a3 ||
      properties.ISO_A2 ||
      properties.iso_a2 ||
      null
    );
  }

  setupMapHover() {
    if (this._onMouseMove) return;

    this._onMouseMove = (e) => {
      const features = this.map.queryRenderedFeatures(e.point, {
        layers: ['highlighted-countries']
      });

      if (features.length === 0) {
        if (this.countriesManager && this._lastHoverFocusCode) {
          this._lastHoverFocusCode = null;
          this.countriesManager.setFocusedCountry(null, 'mapHover');
        }
        this.hide();
        return;
      }

      const geoJsonCountryName = this.getCountryNameFromProperties(features[0].properties);
      const geoJsonCountryIso = this.getCountryIsoFromProperties(features[0].properties);
      if (this.config.DEBUG_LOGS) {
        console.debug('[Map] hover feature', { iso: geoJsonCountryIso, name: geoJsonCountryName });
      }
      if (this.countriesManager) {
        const focusCode = geoJsonCountryIso || null;
        if (focusCode !== this._lastHoverFocusCode) {
          this._lastHoverFocusCode = focusCode;
          this.countriesManager.setFocusedCountry(focusCode, 'mapHover');
        }
      }
      if (!geoJsonCountryName) {
        this.hide();
        return;
      }

      const countryItem = this.findCountryItem({ iso: geoJsonCountryIso, name: geoJsonCountryName });
      const { x: mouseX, y: mouseY } = this.getMouseCoordinates(e);

      if (countryItem) {
        const tooltipInItem = countryItem.querySelector('[' + this.config.ATTRIBUTES.TOOLTIP + ']');
        
        if (tooltipInItem) {
          const tooltipText = tooltipInItem.textContent?.trim() || tooltipInItem.innerText?.trim() || geoJsonCountryName;
          const tooltipHTML = tooltipInItem.innerHTML?.trim();
          
          if (tooltipHTML && tooltipHTML !== tooltipText && tooltipHTML.includes('<')) {
            this.show(tooltipHTML, tooltipText, mouseX, mouseY);
          } else {
            this.show(tooltipText, tooltipText, mouseX, mouseY);
          }
        } else {
          const countryName = countryItem.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME) || geoJsonCountryName;
          this.show(countryName, countryName, mouseX, mouseY);
        }
      } else {
        this.show(geoJsonCountryName, geoJsonCountryName, mouseX, mouseY);
      }
    };

    this._onMouseLeave = () => {
      if (this.countriesManager && this._lastHoverFocusCode) {
        this._lastHoverFocusCode = null;
        this.countriesManager.setFocusedCountry(null, 'mapHover');
      }
      this.hide();
    };

    this._onScroll = () => {
      if (this.countriesManager && this._lastHoverFocusCode) {
        this._lastHoverFocusCode = null;
        this.countriesManager.setFocusedCountry(null, 'mapHover');
      }
      this.hide();
    };

    this.map.on('mousemove', this._onMouseMove);
    this.map.on('mouseleave', this._onMouseLeave);
    window.addEventListener('scroll', this._onScroll, { passive: true });
  }

  show(htmlContent, textContent, x, y) {
    if (!this.tooltip) return;

    const TOOLTIP_OFFSET = 10;
    const hasHTML = htmlContent && htmlContent !== textContent && htmlContent.includes('<');

    if (hasHTML) {
      this.tooltip.innerHTML = htmlContent;
    } else {
      this.tooltip.textContent = textContent || htmlContent;
    }

    Object.assign(this.tooltip.style, {
      display: 'block',
      left: (x + TOOLTIP_OFFSET) + 'px',
      top: (y + TOOLTIP_OFFSET) + 'px'
    });
  }

  hide() {
    if (this.tooltip) {
      this.tooltip.style.display = 'none';
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const mapContainer = document.getElementById(CONFIG.CONTAINER_ID);

  if (mapContainer) {
    const controller = new MapController(CONFIG);
    controller.init().catch(error => {
    });
  } else {
  }
});
