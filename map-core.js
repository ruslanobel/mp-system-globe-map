(function() {
  'use strict';

  if (window.MapCoreLoaded) {
    return;
  }
  window.MapCoreLoaded = true;

  function waitForConfig() {
    return new Promise((resolve) => {
      if (window.CONFIG && window.normalizeIsoCode && window.normalizeCountryName) {
        resolve();
      } else {
        const checkInterval = setInterval(() => {
          if (window.CONFIG && window.normalizeIsoCode && window.normalizeCountryName) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      }
    });
  }

  waitForConfig().then(() => {
    const CONFIG = window.CONFIG;
    const normalizeIsoCode = window.normalizeIsoCode;
    const normalizeCountryName = window.normalizeCountryName;

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
              set: () => {},
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
        const referenceSize = 2200;
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
          center: initialCenter,
          zoom: initialZoom,
          pitch: 0,
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
        if (window.GeocodingService) {
          this.geocodingService = new window.GeocodingService(mapboxgl.accessToken);
        }
        this.countriesManager = new CountriesManager(this.map, this.config);
        this.countriesManager.loadFromDOM();
        this.countriesManager.highlightCountries();
        this.listFocusManager = new CountryListFocusManager(this, this.config, this.countriesManager);
        this.listFocusManager.init();
        if (window.OfficesManager && this.geocodingService) {
          this.officesManager = new window.OfficesManager(this.map, this.config, this.geocodingService);
          await this.waitForOfficeElements();
          await this.officesManager.loadFromDOM();
          this.officesManager.createMarkers();
        }
        if (window.ModalManager) {
          this.modalManager = new window.ModalManager(this.map, this.config);
          this.modalManager.init();
          if (this.officesManager) {
            this.officesManager.setModalManager(this.modalManager);
          }
        }
        if (window.TooltipManager) {
          this.tooltipManager = new window.TooltipManager(this.map, this.config, this.countriesManager);
          this.tooltipManager.init();
        }
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
        const SCROLL_DELAY_MS = 500;
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
          if (e.button === 0) {
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
        let hasAnimated = false;
        const targetCenter = this.config.INITIAL_CENTER;
        const observerOptions = {
          root: null,
          rootMargin: '0px',
          threshold: 0.1
        };
        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !hasAnimated) {
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
        })).filter(country => country.iso);
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
                return coords.length / 2;
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
        this._onTap = null;
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
            this.attachTap();
            this.clearFocus();
          } else {
            this.detachTap();
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

      attachTap() {
        if (this._onTap) return;
        this._onTap = (e) => {
          const item = e.target?.closest?.('[' + this.config.ATTRIBUTES.LIST_ITEM + ']');
          if (item) {
            if (this._hoveredItem === item) {
              this._hoveredItem = null;
              this.clearFocus();
              return;
            }
            this._hoveredItem = item;
            this.scheduleFocus(item, 0);
            return;
          }
          if (this._hoveredItem) {
            this._hoveredItem = null;
            this.clearFocus();
          }
        };
        document.addEventListener('click', this._onTap, true);
      }

      detachTap() {
        if (this._onTap) {
          document.removeEventListener('click', this._onTap, true);
          this._onTap = null;
        }
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

      scheduleFocus(item, delayOverride) {
        this.clearTimers();
        this._sequence += 1;
        const sequence = this._sequence;
        const delayMs = typeof delayOverride === 'number' ? delayOverride : this.config.LIST_HOVER_FOCUS_DELAY_MS;
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
          const breakpoint = Number(this.config.LIST_FOCUS_OFFSET_BREAKPOINT_PX) || 0;
          const useMobileOffset = breakpoint > 0 && window.innerWidth <= breakpoint;
          const baseRatio = this.config.LIST_FOCUS_OFFSET_Y_RATIO || 0;
          const mobileRatio = this.config.LIST_FOCUS_OFFSET_Y_RATIO_MOBILE;
          const ratio = useMobileOffset && typeof mobileRatio === 'number' ? mobileRatio : baseRatio;
          const offsetY = -containerHeight * ratio;
          this.controller.easeToCamera({
            center: target.center,
            offset: [0, offsetY],
            duration: this.config.LIST_FOCUS_ANIMATION_DURATION_MS,
            easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
          });
        }, delayMs);
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

    window.MapController = MapController;
    window.CountriesManager = CountriesManager;
    window.CountryListFocusManager = CountryListFocusManager;
  });

})();
