(function() {
  'use strict';

  if (window.MapUILoaded) {
    return;
  }
  window.MapUILoaded = true;

  function waitForDependencies() {
    return new Promise((resolve) => {
      const checkDeps = () => {
        if (window.CONFIG && window.normalizeIsoCode && window.normalizeCountryName) {
          resolve();
        } else {
          setTimeout(checkDeps, 50);
        }
      };
      checkDeps();
    });
  }

  waitForDependencies().then(() => {
    const CONFIG = window.CONFIG;
    const normalizeIsoCode = window.normalizeIsoCode;
    const normalizeCountryName = window.normalizeCountryName;

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
              pinElement: pinElement,
              officeItem: officeItem
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
        if (modal.parentNode !== document.body) {
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
        if (modal.parentNode !== document.body) {
          document.body.appendChild(modal);
        }
        let originalDisplay = 'flex';
        if (modal.style.display === 'none' || window.getComputedStyle(modal).display === 'none') {
          const tempDisplay = modal.style.display;
          modal.style.display = '';
          originalDisplay = window.getComputedStyle(modal).display || 'flex';
          modal.style.display = tempDisplay;
        } else {
          originalDisplay = window.getComputedStyle(modal).display || 'flex';
        }
        modal.style.zIndex = '10000';
        modal.style.display = originalDisplay;
        modal.style.visibility = 'hidden';
        this.positionModal(modal, markerPosition);
        modal.style.visibility = '';
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
        const modalRect = modal.getBoundingClientRect();
        const viewportPadding = 12;
        const maxLeft = Math.max(viewportPadding, window.innerWidth - modalRect.width - viewportPadding);
        const maxTop = Math.max(viewportPadding, window.innerHeight - modalRect.height - viewportPadding);
        let left = absoluteX + offsetPx;
        let top = absoluteY;
        if (modalRect.width) {
          left = Math.min(Math.max(left, viewportPadding), maxLeft);
        } else {
          left = Math.max(left, viewportPadding);
        }
        if (modalRect.height) {
          top = Math.min(Math.max(top, viewportPadding), maxTop);
        } else {
          top = Math.max(top, viewportPadding);
        }
        Object.assign(modal.style, {
          position: 'fixed',
          left: left + 'px',
          top: top + 'px',
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
          if (byIso) return byIso;
        }
        const normalizedName = normalizeCountryName(name);
        if (normalizedName) {
          const byName = this._countryItemByName.get(normalizedName);
          if (byName) return byName;
        }
        return this.findCountryItemByName(name);
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

    window.GeocodingService = GeocodingService;
    window.OfficesManager = OfficesManager;
    window.ModalManager = ModalManager;
    window.TooltipManager = TooltipManager;

    function initMap() {
      if (window.MapInitialized) {
        return;
      }
      const mapContainer = document.getElementById(CONFIG.CONTAINER_ID);
      if (!mapContainer) {
        return;
      }
      if (!window.MapController) {
        setTimeout(initMap, 100);
        return;
      }
      window.MapInitialized = true;
      const controller = new window.MapController(CONFIG);
      controller.init().catch(error => {
      });
    }

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', initMap);
    } else {
      initMap();
    }
  });

})();

