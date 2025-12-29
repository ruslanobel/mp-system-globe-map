---
name: Webflow Map Integration
overview: "Поэтапная интеграция Mapbox карты с Webflow CMS. Разделено на фазы: подготовка Webflow, базовая карта, функционал стран, функционал офисов, UI интеракции."
todos:
  - id: phase0-webflow-prep
    content: "ФАЗА 0: Подготовка Webflow (делает пользователь) - создать HTML структуру, добавить Custom Code, настроить data-атрибуты"
    status: pending
  - id: phase1-basic-map
    content: "ФАЗА 1: Создать базовую карту с drag функционалом - минимальный script.js с MapController"
    status: pending
  - id: phase2-disable-zoom
    content: "ФАЗА 2: Отключить зум колесиком - добавить map.scrollZoom.disable()"
    status: pending
  - id: phase3-countries-highlight
    content: "ФАЗА 3: Загрузка и закрашивание стран - CountriesManager с loadFromDOM и highlightCountries"
    status: completed
  - id: phase4-country-tooltip
    content: "ФАЗА 4: Hover на страну с tooltip - TooltipManager для отображения названия"
    status: completed
  - id: phase5-country-focus
    content: "ФАЗА 5: Фокус на страну при hover на список - data-map-list-item + плавный focus + подсветка"
    status: completed
  - id: phase6-offices-markers
    content: "ФАЗА 6: Геокодирование и маркеры офисов - GeocodingService и OfficesManager"
    status: completed
  - id: phase7-office-modal
    content: "ФАЗА 7: Модальное окно при клике на офис - ModalManager с блокировкой drag"
    status: pending
  - id: phase8-documentation
    content: "ФАЗА 8: Создать webflow-integration-guide.md с полной инструкцией и примерами"
    status: pending
---

# Поэтапный план интеграции Mapbox карты с Webflow CMS

https://staging-mp-bestsite.webflow.io/ — стейджинг webflow с подключенным к нему скрипту через <script defer src="http://127.0.0.1:5500/script.js"></script>

## ФАЗА 0: Подготовка Webflow (делаете вы)

Перед началом разработки вам нужно подготовить в Webflow:

### 0.1 HTML структура

- Создать контейнер карты: `<div id="globe-map"></div>`
- Добавить Collection List для стран (можно скрыть display: none, если не нужен визуально)
- Добавить Collection List для офисов (можно скрыть display: none)
- Создать элементы для UI (пока пустые div'ы):
  - Tooltip для названия страны (скрыт)
  - Модальное окно для офиса (скрыто)
  - Шаблон пина офиса (скрыт)

### 0.2 Custom Code в Head

```html
<script>
  window.MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoicnVzbGFuLW9iZWwiLCJhIjoiY21pcHVnZW03MDZoaDNrczg1dW85M3h0YSJ9.YhTGXN-mgeoWWXiJtybdXg';
</script>
<script src='https://api.mapbox.com/mapbox-gl-js/v3.17.0/mapbox-gl.js'></script>
<link href='https://api.mapbox.com/mapbox-gl-js/v3.17.0/mapbox-gl.css' rel='stylesheet' />
```

### 0.3 Data-атрибуты (минимальный набор для старта)

На Collection List элементы стран:

- `data-map-country-item` - на wrapper каждой страны
- `data-map-country-name="Austria"` - атрибут с названием страны

На Collection List элементы офисов:

- `data-map-office-item` - на wrapper каждого офиса
- `data-map-office-address="Rosa-Luxemburg-Straße 49, 10178 Berlin, Germany"` - полный адрес

### 0.4 CSS для контейнера карты

```css
#globe-map {
  width: 100%;
  height: 600px; /* или любая нужная высота */
  position: relative;
}
```

**После подготовки сообщите "Webflow готов", и мы перейдем к Фазе 1.**

---

## ФАЗА 1: Базовая карта с drag функционалом

**Цель**: Убедиться, что карта инициализируется и работает перетаскивание.

### Создадим минимальный `script.js`:

```javascript
// КОНФИГУРАЦИЯ
const CONFIG = {
  MAPBOX_STYLE: 'mapbox://styles/ruslan-obel/cmit1vgga002501s612mlecmi',
  CONTAINER_ID: 'globe-map',
  INITIAL_CENTER: [13.4, 52.5], // Берлин (центр Европы)
  INITIAL_ZOOM: 3.5
};

// MAIN CONTROLLER
class MapController {
  constructor(config) {
    this.config = config;
    this.map = null;
  }
  
  async init() {
    if (!window.MAPBOX_ACCESS_TOKEN) {
      console.error('MAPBOX_ACCESS_TOKEN is not defined');
      return;
    }
    
    mapboxgl.accessToken = window.MAPBOX_ACCESS_TOKEN;
    
    this.map = new mapboxgl.Map({
      container: this.config.CONTAINER_ID,
      style: this.config.MAPBOX_STYLE,
      projection: 'globe',
      center: this.config.INITIAL_CENTER,
      zoom: this.config.INITIAL_ZOOM
    });
    
    await new Promise((resolve) => this.map.on('load', resolve));
    
    console.log('✅ Map initialized successfully');
    console.log('✅ Drag is enabled by default');
  }
}

// АВТОИНИЦИАЛИЗАЦИЯ
window.addEventListener('DOMContentLoaded', () => {
  const mapContainer = document.getElementById(CONFIG.CONTAINER_ID);
  
  if (mapContainer) {
    const controller = new MapController(CONFIG);
    controller.init().catch(error => {
      console.error('❌ Failed to initialize map:', error);
    });
  } else {
    console.error('❌ Map container not found:', CONFIG.CONTAINER_ID);
  }
});
```

**Тестирование Фазы 1**:

- Карта отображается
- Можно перетаскивать мышью (drag работает по умолчанию)
- В консоли: "Map initialized successfully"

**После успешного теста переходим к Фазе 2.**

---

## ФАЗА 2: Отключение зума колесиком

**Цель**: Добавить настройку отключения scroll zoom.

### Обновим MapController:

```javascript
async init() {
  // ... существующий код инициализации карты ...
  
  await new Promise((resolve) => this.map.on('load', resolve));
  
  // Отключаем зум колесиком
  this.map.scrollZoom.disable();
  
  console.log('✅ Map initialized successfully');
  console.log('✅ Scroll zoom disabled');
}
```

**Тестирование Фазы 2**:

- Колесико мыши НЕ зумирует карту
- Drag все еще работает

**После успешного теста переходим к Фазе 3.**

---

## ФАЗА 3: Загрузка и закрашивание стран

**Цель**: Считать страны из DOM и закрасить их на карте красным цветом.

### Добавим в CONFIG:

```javascript
const CONFIG = {
  // ... существующие настройки ...
  COUNTRY_COLOR: '#F3223F',
  ATTRIBUTES: {
    COUNTRY_ITEM: 'data-map-country-item',
    COUNTRY_NAME: 'data-map-country-name'
  }
};
```

### Создадим CountriesManager:

```javascript
class CountriesManager {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this.countries = [];
  }
  
  loadFromDOM() {
    const items = document.querySelectorAll(`[${this.config.ATTRIBUTES.COUNTRY_ITEM}]`);
    this.countries = Array.from(items).map(item => ({
      name: item.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME)
    }));
    
    console.log(`📍 Loaded ${this.countries.length} countries:`, this.countries.map(c => c.name));
    return this.countries;
  }
  
  highlightCountries() {
    if (this.countries.length === 0) {
      console.warn('⚠️ No countries to highlight');
      return;
    }
    
    const countryNames = this.countries.map(c => c.name);
    
    this.map.addLayer({
      id: 'highlighted-countries',
      type: 'fill',
      source: 'composite',
      'source-layer': 'admin',
      filter: [
        'all',
        ['==', ['get', 'admin_level'], 0],
        ['in', ['get', 'name_en'], ['literal', countryNames]]
      ],
      paint: {
        'fill-color': this.config.COUNTRY_COLOR,
        'fill-opacity': 0.7
      }
    });
    
    console.log('✅ Countries highlighted');
  }
}
```

### Обновим MapController:

```javascript
class MapController {
  constructor(config) {
    this.config = config;
    this.map = null;
    this.countriesManager = null;
  }
  
  async init() {
    // ... существующий код инициализации ...
    
    await new Promise((resolve) => this.map.on('load', resolve));
    
    this.map.scrollZoom.disable();
    
    // Инициализация стран
    this.countriesManager = new CountriesManager(this.map, this.config);
    this.countriesManager.loadFromDOM();
    this.countriesManager.highlightCountries();
    
    console.log('✅ Map initialized successfully');
  }
}
```

**Тестирование Фазы 3**:

- Страны из CMS закрашены красным (#F3223F)
- В консоли список загруженных стран

**После успешного теста переходим к Фазе 4.**

---

## ФАЗА 4: Hover на страну (tooltip с названием)

**Цель**: При наведении на закрашенную страну показывать её название рядом с курсором.

### Обновим CONFIG:

```javascript
const CONFIG = {
  // ... существующие настройки ...
  ATTRIBUTES: {
    COUNTRY_ITEM: 'data-map-country-item',
    COUNTRY_NAME: 'data-map-country-name',
    TOOLTIP: 'data-map-tooltip',
    TOOLTIP_TEXT: 'data-map-tooltip-text'
  }
};
```

### Создадим TooltipManager:

```javascript
class TooltipManager {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this.tooltip = null;
    this.tooltipText = null;
  }
  
  init() {
    this.tooltip = document.querySelector(`[${this.config.ATTRIBUTES.TOOLTIP}]`);
    this.tooltipText = this.tooltip?.querySelector(`[${this.config.ATTRIBUTES.TOOLTIP_TEXT}]`);
    
    if (!this.tooltip) {
      console.warn('⚠️ Tooltip element not found');
      return;
    }
    
    this.tooltip.style.display = 'none';
    this.tooltip.style.position = 'fixed';
    this.tooltip.style.pointerEvents = 'none';
    this.tooltip.style.zIndex = '9999';
    
    this.setupMapHover();
  }
  
  setupMapHover() {
    this.map.on('mousemove', (e) => {
      const features = this.map.queryRenderedFeatures(e.point, {
        layers: ['highlighted-countries']
      });
      
      if (features.length > 0) {
        const countryName = features[0].properties.name_en;
        this.show(countryName, e.originalEvent.clientX, e.originalEvent.clientY);
      } else {
        this.hide();
      }
    });
  }
  
  show(text, x, y) {
    if (!this.tooltip) return;
    
    this.tooltipText.textContent = text;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${x + 15}px`;
    this.tooltip.style.top = `${y + 15}px`;
  }
  
  hide() {
    if (this.tooltip) {
      this.tooltip.style.display = 'none';
    }
  }
}
```

### Обновим MapController:

```javascript
async init() {
  // ... существующий код ...
  
  this.countriesManager = new CountriesManager(this.map, this.config);
  this.countriesManager.loadFromDOM();
  this.countriesManager.highlightCountries();
  
  // Инициализация tooltip
  this.tooltipManager = new TooltipManager(this.map, this.config);
  this.tooltipManager.init();
  
  console.log('✅ Map initialized successfully');
}
```

**Тестирование Фазы 4**:

- При наведении на страну появляется tooltip с названием
- Tooltip следует за курсором
- При уходе курсора tooltip исчезает

**После успешного теста переходим к Фазе 5.**

---

## ФАЗА 5: Фокус на страну при hover на список

**Цель**: При наведении на элемент списка стран карта плавно фокусируется на этой стране.

### Реализация в текущем проекте

- В Webflow на каждый элемент списка добавляем `data-map-list-item`.
- Внутри этого элемента должны быть доступны `data-map-country-iso` и/или `data-map-country-name` (можно на самом элементе или на вложенном).
- При hover карта делает `easeTo({ center })` (без изменения zoom), а заливка страны на время фокуса меняется на `#C71F37`.
- Чтобы при быстром движении курсора не было «хаотичного» вращения, используется задержка перед фокусом + отмена предыдущих анимаций.

**Тестирование Фазы 5**:

- При наведении на элемент списка страны карта плавно фокусируется
- Используется easeTo (плавное смещение без зума)
 - При быстром hover по разным пунктам фокус сглаживается (не дергается на каждый пиксель движения)

**После успешного теста переходим к Фазе 6.**

---

## ФАЗА 6: Геокодирование и маркеры офисов

**Цель**: Загрузить офисы из DOM, получить координаты через геокодирование, отобразить пины.

### Обновим CONFIG:

```javascript
const CONFIG = {
  // ... существующие настройки ...
  ATTRIBUTES: {
    // ... существующие атрибуты ...
    OFFICE_ITEM: 'data-map-office-item',
    OFFICE_ADDRESS: 'data-map-office-address',
    PIN_TEMPLATE: 'data-map-pin-template'
  }
};
```

### Создадим GeocodingService:

```javascript
class GeocodingService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.cache = new Map();
  }
  
  async geocodeAddress(address) {
    if (this.cache.has(address)) {
      console.log(`📍 Using cached coordinates for: ${address}`);
      return this.cache.get(address);
    }
    
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`;
    const response = await fetch(`${url}?access_token=${this.accessToken}`);
    
    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      const coordinates = data.features[0].center;
      this.cache.set(address, coordinates);
      console.log(`✅ Geocoded: ${address} -> [${coordinates}]`);
      return coordinates;
    }
    
    throw new Error(`No results for address: ${address}`);
  }
}
```

### Создадим OfficesManager:

```javascript
class OfficesManager {
  constructor(map, config, geocodingService) {
    this.map = map;
    this.config = config;
    this.geocodingService = geocodingService;
    this.offices = [];
    this.markers = [];
  }
  
  async loadFromDOM() {
    const items = document.querySelectorAll(`[${this.config.ATTRIBUTES.OFFICE_ITEM}]`);
    console.log(`📍 Found ${items.length} office items in DOM`);
    
    for (const item of items) {
      const address = item.getAttribute(this.config.ATTRIBUTES.OFFICE_ADDRESS);
      
      if (!address) {
        console.warn('⚠️ Office item missing address attribute');
        continue;
      }
      
      try {
        const coordinates = await this.geocodingService.geocodeAddress(address);
        
        this.offices.push({
          address: address,
          coordinates: coordinates,
          element: item
        });
      } catch (error) {
        console.error(`❌ Failed to geocode: ${address}`, error);
      }
    }
    
    console.log(`✅ Loaded ${this.offices.length} offices with coordinates`);
    return this.offices;
  }
  
  createMarkers() {
    const pinTemplate = document.querySelector(`[${this.config.ATTRIBUTES.PIN_TEMPLATE}]`);
    
    if (!pinTemplate) {
      console.error('❌ Pin template not found');
      return;
    }
    
    this.offices.forEach((office, index) => {
      const pinElement = pinTemplate.cloneNode(true);
      pinElement.removeAttribute(this.config.ATTRIBUTES.PIN_TEMPLATE);
      pinElement.style.display = 'block';
      
      const marker = new mapboxgl.Marker(pinElement)
        .setLngLat(office.coordinates)
        .addTo(this.map);
      
      this.markers.push({ marker, office });
      console.log(`📍 Marker ${index + 1} added at [${office.coordinates}]`);
    });
    
    console.log(`✅ Created ${this.markers.length} markers`);
  }
}
```

### Обновим MapController:

```javascript
class MapController {
  constructor(config) {
    this.config = config;
    this.map = null;
    this.geocodingService = null;
    this.countriesManager = null;
    this.officesManager = null;
    this.tooltipManager = null;
  }
  
  async init() {
    // ... существующий код инициализации карты ...
    
    await new Promise((resolve) => this.map.on('load', resolve));
    
    this.map.scrollZoom.disable();
    
    // Инициализация сервисов
    this.geocodingService = new GeocodingService(mapboxgl.accessToken);
    
    // Страны
    this.countriesManager = new CountriesManager(this.map, this.config);
    this.countriesManager.loadFromDOM();
    this.countriesManager.highlightCountries();
    this.countriesManager.setupListHover();
    
    // Офисы
    this.officesManager = new OfficesManager(this.map, this.config, this.geocodingService);
    await this.officesManager.loadFromDOM(); // async!
    this.officesManager.createMarkers();
    
    // Tooltip
    this.tooltipManager = new TooltipManager(this.map, this.config);
    this.tooltipManager.init();
    
    console.log('✅ Map initialized successfully');
  }
}
```

**Тестирование Фазы 6**:

- Адреса офисов геокодируются через Mapbox API
- Пины отображаются на карте в правильных местах
- В консоли логи геокодирования

**После успешного теста переходим к Фазе 7.**

---

## ФАЗА 7: Модальное окно при клике на офис

**Цель**: При клике на пин офиса показывать модалку с информацией. Блокировать drag пока модалка открыта.

### Обновим CONFIG:

```javascript
const CONFIG = {
  // ... существующие настройки ...
  ATTRIBUTES: {
    // ... существующие атрибуты ...
    OFFICE_NAME: 'data-map-office-name',
    OFFICE_DESCRIPTION: 'data-map-office-description',
    OFFICE_PHONE: 'data-map-office-phone',
    OFFICE_EMAIL: 'data-map-office-email',
    OFFICE_LINK: 'data-map-office-link',
    MODAL: 'data-map-modal',
    MODAL_CONTENT: 'data-map-modal-content',
    MODAL_CLOSE: 'data-map-modal-close'
  }
};
```

### Создадим ModalManager:

```javascript
class ModalManager {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this.modal = null;
    this.modalContent = null;
    this.modalClose = null;
    this.isOpen = false;
  }
  
  init() {
    this.modal = document.querySelector(`[${this.config.ATTRIBUTES.MODAL}]`);
    this.modalContent = document.querySelector(`[${this.config.ATTRIBUTES.MODAL_CONTENT}]`);
    this.modalClose = document.querySelector(`[${this.config.ATTRIBUTES.MODAL_CLOSE}]`);
    
    if (!this.modal) {
      console.warn('⚠️ Modal element not found');
      return;
    }
    
    this.modal.style.display = 'none';
    
    if (this.modalClose) {
      this.modalClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
    }
    
    // Клик по карте закрывает модалку
    this.map.on('click', () => {
      if (this.isOpen) {
        this.close();
      }
    });
    
    console.log('✅ Modal initialized');
  }
  
  show(office, markerPosition) {
    if (!this.modal) return;
    
    // Заполняем контент
    const name = office.element.querySelector(`[${this.config.ATTRIBUTES.OFFICE_NAME}]`)?.textContent || 'Office';
    const description = office.element.querySelector(`[${this.config.ATTRIBUTES.OFFICE_DESCRIPTION}]`)?.innerHTML || '';
    const phone = office.element.getAttribute(this.config.ATTRIBUTES.OFFICE_PHONE) || '';
    const email = office.element.getAttribute(this.config.ATTRIBUTES.OFFICE_EMAIL) || '';
    const link = office.element.getAttribute(this.config.ATTRIBUTES.OFFICE_LINK) || '';
    
    let html = `<h3>${name}</h3>`;
    html += `<p>${office.address}</p>`;
    if (description) html += `<div>${description}</div>`;
    if (phone) html += `<p>Phone: ${phone}</p>`;
    if (email) html += `<p>Email: ${email}</p>`;
    if (link) html += `<a href="${link}" target="_blank">View on map</a>`;
    
    this.modalContent.innerHTML = html;
    
    // Позиционируем рядом с маркером
    const point = this.map.project(markerPosition);
    this.modal.style.display = 'block';
    this.modal.style.position = 'absolute';
    this.modal.style.left = `${point.x + 20}px`;
    this.modal.style.top = `${point.y}px`;
    
    // Блокируем drag
    this.map.dragPan.disable();
    this.isOpen = true;
    
    console.log('✅ Modal opened');
  }
  
  close() {
    if (this.modal) {
      this.modal.style.display = 'none';
    }
    
    // Разблокируем drag
    this.map.dragPan.enable();
    this.isOpen = false;
    
    console.log('✅ Modal closed');
  }
}
```

### Обновим OfficesManager для обработки кликов:

```javascript
createMarkers() {
  const pinTemplate = document.querySelector(`[${this.config.ATTRIBUTES.PIN_TEMPLATE}]`);
  
  if (!pinTemplate) {
    console.error('❌ Pin template not found');
    return;
  }
  
  this.offices.forEach((office, index) => {
    const pinElement = pinTemplate.cloneNode(true);
    pinElement.removeAttribute(this.config.ATTRIBUTES.PIN_TEMPLATE);
    pinElement.style.display = 'block';
    
    const marker = new mapboxgl.Marker(pinElement)
      .setLngLat(office.coordinates)
      .addTo(this.map);
    
    // Обработчик клика
    pinElement.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onMarkerClick(office, marker);
    });
    
    this.markers.push({ marker, office });
  });
  
  console.log(`✅ Created ${this.markers.length} markers with click handlers`);
}

onMarkerClick(office, marker) {
  if (this.modalManager) {
    this.modalManager.show(office, office.coordinates);
  }
}

// Добавим метод для связи с ModalManager
setModalManager(modalManager) {
  this.modalManager = modalManager;
}
```

### Обновим MapController:

```javascript
async init() {
  // ... существующий код ...
  
  // Офисы
  this.officesManager = new OfficesManager(this.map, this.config, this.geocodingService);
  await this.officesManager.loadFromDOM();
  this.officesManager.createMarkers();
  
  // Modal
  this.modalManager = new ModalManager(this.map, this.config);
  this.modalManager.init();
  
  // Связываем офисы с модалкой
  this.officesManager.setModalManager(this.modalManager);
  
  // Tooltip
  this.tooltipManager = new TooltipManager(this.map, this.config);
  this.tooltipManager.init();
  
  console.log('✅ Map initialized successfully');
}
```

**Тестирование Фазы 7**:

- Клик по пину открывает модалку с информацией
- Drag карты отключен пока модалка открыта
- Клик по крестику закрывает модалку
- Клик по пустой области карты закрывает модалку
- После закрытия drag снова работает

**После успешного теста переходим к Фазе 8.**

---

## ФАЗА 8: Документация для Webflow

Создадим подробную инструкцию `webflow-integration-guide.md` с:

1. Полной HTML структурой для Webflow
2. Таблицей всех data-атрибутов
3. Примерами CSS стилей
4. Инструкциями по Custom Code
5. Чеклистом для проверки

---

## Итоговая структура проекта

```
Map/
├── script.js              (единый файл со всем функционалом)
├── webflow-integration-guide.md  (инструкция)
└── README.md              (обновленное описание)
```

**Весь код в одном файле script.js, разделен на логические классы для удобства редактирования.**
