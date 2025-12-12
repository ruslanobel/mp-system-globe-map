// КОНФИГУРАЦИЯ
const CONFIG = {
  STYLE_JSON_PATH: './style.json', // Локальный файл стиля
  CONTAINER_ID: 'globe-map',
  INITIAL_CENTER: [13.4, 0], // Экватор, долгота Европы (для центрирования Европы)
  // Ограничения для вертикального вращения (latitude)
  LATITUDE_MIN: -30, // Минимальная широта (ограничивает прокрутку к северному полюсу)
  LATITUDE_MAX: 30,  // Максимальная широта (ограничивает прокрутку к южному полюсу)
  INITIAL_ZOOM: 5,
  // Настройки для квадратного контейнера
  GLOBE_PADDING: {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  },
  // ФАЗА 3: Настройки для стран
  COUNTRY_COLOR: '#F3223F',
  COUNTRY_STROKE_COLOR: '#FFFFFF',
  COUNTRY_STROKE_WIDTH: 1,
  COUNTRY_FILL_OPACITY: 0.9, // Увеличена непрозрачность для более насыщенного цвета
  // Используем максимально детализированные источники GeoJSON (Natural Earth 10m)
  // Система автоматически пробует несколько источников для максимальной детализации границ
  COUNTRIES_GEOJSON_URL: 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
  // Минимальное количество координат для оценки качества источника
  MIN_COORDINATES_THRESHOLD: 10000,
  ATTRIBUTES: {
    COUNTRY_ITEM: 'data-map-country-item',
    COUNTRY_NAME: 'data-map-country-name',
    COUNTRY_ISO: 'data-map-country-iso'
  }
};

// MAIN CONTROLLER
class MapController {
  constructor(config) {
    this.config = config;
    this.map = null;
    this.countriesManager = null;
  }
  
  /**
   * Загружает локальный стиль из JSON файла
   * @returns {Promise<Object>} Объект стиля для Mapbox
   */
  async loadStyle() {
    try {
      const response = await fetch(this.config.STYLE_JSON_PATH);
      
      if (!response.ok) {
        throw new Error(`Failed to load style: ${response.statusText}`);
      }
      
      const styleData = await response.json();
      console.log('✅ Style loaded from local file:', this.config.STYLE_JSON_PATH);
      return styleData;
    } catch (error) {
      console.error('❌ Failed to load local style:', error);
      // Используем оригинальный стиль из Mapbox Studio вместо стандартного fallback
      // Это сохраняет минималистичный стиль глобуса
      return 'mapbox://styles/ruslan-obel/cmit1vgga002501s612mlecmi';
    }
  }
  
  /**
   * Отключает все интерактивные элементы карты кроме drag
   */
  disableMapControls() {
    this.map.scrollZoom.disable();
    this.map.boxZoom.disable();
    this.map.doubleClickZoom.disable();
    this.map.touchZoomRotate.disable();
    this.map.dragRotate.disable();
    this.map.keyboard.disable();
    
    // Отключаем touchPitch для предотвращения изменения pitch на сенсорных устройствах
    if (this.map.touchPitch) {
      this.map.touchPitch.disable();
    }
    // dragPan остаётся включённым (по умолчанию)
  }
  
  /**
   * Фиксирует pitch на 0 для ортографического вида
   */
  fixPitch() {
    this.map.setPitch(0);
    this.map.setMinPitch(0);
    this.map.setMaxPitch(0);
  }
  
  /**
   * Ограничивает вертикальное вращение (latitude) при drag
   * Предотвращает прокрутку глобуса к полюсам, что вызывает автоматическое зумирование
   */
  limitVerticalRotation() {
    let isCorrecting = false;
    
    const correctLatitude = () => {
      if (isCorrecting) return;
      
      const center = this.map.getCenter();
      const currentLat = center.lat;
      const currentLng = center.lng;
      
      // Ограничиваем latitude в пределах заданных границ
      if (currentLat < this.config.LATITUDE_MIN || currentLat > this.config.LATITUDE_MAX) {
        isCorrecting = true;
        
        // Ограничиваем latitude до допустимых значений
        const clampedLat = Math.max(
          this.config.LATITUDE_MIN,
          Math.min(this.config.LATITUDE_MAX, currentLat)
        );
        
        // Устанавливаем новый центр с ограниченной latitude
        // Используем easeTo для плавного перехода вместо резкого setCenter
        this.map.easeTo({
          center: [currentLng, clampedLat],
          duration: 0, // Мгновенная коррекция для предотвращения визуального "дергания"
          essential: true // Критично для предотвращения зумирования
        });
        
        requestAnimationFrame(() => {
          isCorrecting = false;
        });
      }
    };
    
    // Отслеживаем изменения центра при drag и move
    // Используем moveend для финальной коррекции после завершения drag
    this.map.on('move', correctLatitude);
    this.map.on('drag', correctLatitude);
    this.map.on('moveend', correctLatitude);
    
    console.log(`✅ Vertical rotation limited: latitude ${this.config.LATITUDE_MIN}° to ${this.config.LATITUDE_MAX}°`);
  }
  
  /**
   * Предотвращает автоматическое изменение zoom и pitch при drag
   * Дополнительно отслеживает события zoom для более надежного контроля
   */
  preventAutoZoom() {
    let isCorrectingZoom = false;
    let programmaticZoomChange = false;
    
    const correctZoomAndPitch = () => {
      // Игнорируем события во время программного изменения zoom (например, из centerGlobe)
      if (programmaticZoomChange) return;
      
      if (isCorrectingZoom) return;
      
      // Пересчитываем targetZoomValue динамически при каждом вызове
      // Это исправляет проблему, когда ограничения слетают после изменения размера окна
      const container = document.getElementById(this.config.CONTAINER_ID);
      const targetZoomValue = container 
        ? Math.log2(container.offsetWidth / 256) 
        : this.config.INITIAL_ZOOM;
      
      const currentZoom = this.map.getZoom();
      const currentPitch = this.map.getPitch();
      
      // Предотвращаем изменение zoom при drag или прокрутке к полюсам
      if (Math.abs(currentZoom - targetZoomValue) > 0.001) {
        isCorrectingZoom = true;
        // Используем easeTo вместо setZoom для предотвращения рекурсивных вызовов
        this.map.easeTo({
          zoom: targetZoomValue,
          duration: 0,
          essential: true
        });
        requestAnimationFrame(() => {
          isCorrectingZoom = false;
        });
      }
      
      // Фиксируем pitch на 0
      if (Math.abs(currentPitch) > 0.001) {
        this.map.setPitch(0);
      }
    };
    
    // Отслеживаем изменения через события move и zoom
    this.map.on('move', correctZoomAndPitch);
    this.map.on('zoom', correctZoomAndPitch);
    
    // Сохраняем функцию для использования в centerGlobe
    this._setProgrammaticZoomChange = (value) => {
      programmaticZoomChange = value;
    };
  }
  
  /**
   * Фиксирует _projectionScaler для предотвращения автоматического зумирования при прокрутке к полюсам
   * Решение основано на патчинге внутренней переменной Mapbox GL JS transform._projectionScaler
   * Устанавливает значение в 1.0 вместо вычисления на основе широты
   * 
   * Примечание: Фиксированная высота может привести к более выраженному упрощению текстур
   * у полюсов (texture minification), что может вызвать артефакты текстуры.
   * Логика потоковой передачи тайлов все еще использует традиционные уровни zoom,
   * что означает, что больше тайлов будет видно при удалении камеры от карты.
   */
  fixProjectionScaler() {
    if (!this.map || !this.map.transform) {
      console.warn('⚠️ Map or transform not available for projection scaler fix');
      return false;
    }
    
    const transform = this.map.transform;
    
    // Проверяем, существует ли _projectionScaler
    if (typeof transform._projectionScaler === 'undefined') {
      // Пробуем установить значение после следующего рендера
      return false;
    }
    
    // Используем Object.defineProperty для перехвата изменений _projectionScaler
    // Сохраняем оригинальное значение дескриптора если еще не было перехвачено
    if (!transform._projectionScalerFixed) {
      try {
        // Пытаемся использовать defineProperty для создания геттера/сеттера
        const descriptor = Object.getOwnPropertyDescriptor(transform, '_projectionScaler') ||
                          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(transform), '_projectionScaler');
        
        if (descriptor && descriptor.configurable) {
          // Сохраняем оригинальное значение
          const originalValue = transform._projectionScaler;
          
          Object.defineProperty(transform, '_projectionScaler', {
            get: function() {
              return 1.0; // Всегда возвращаем фиксированное значение
            },
            set: function(value) {
              // Игнорируем попытки установить другое значение
              // Внутренне используем 1.0
            },
            configurable: true,
            enumerable: true
          });
          
          transform._projectionScalerFixed = true;
          console.log('✅ Projection scaler fixed using property descriptor');
          return true;
        }
      } catch (e) {
        // Если defineProperty не работает, используем альтернативный подход
        console.log('⚠️ Property descriptor approach failed, using direct patching');
      }
    }
    
    // Альтернативный подход: прямое перехватывание через регулярную проверку
    // Устанавливаем фиксированное значение
    transform._projectionScaler = 1.0;
    
    // Перехватываем изменения через событие move
    if (!transform._projectionScalerWatcher) {
      let isUpdating = false;
      const watcher = () => {
        if (!isUpdating && transform._projectionScaler !== undefined) {
          isUpdating = true;
          requestAnimationFrame(() => {
            if (transform._projectionScaler !== 1.0) {
              transform._projectionScaler = 1.0;
            }
            isUpdating = false;
          });
        }
      };
      
      this.map.on('move', watcher);
      this.map.on('zoom', watcher);
      transform._projectionScalerWatcher = watcher;
      transform._projectionScalerFixed = true;
      
      console.log('✅ Projection scaler fixed using event watcher');
      return true;
    }
    
    return true;
  }
  
  async init() {
    if (!window.MAPBOX_ACCESS_TOKEN) {
      console.error('MAPBOX_ACCESS_TOKEN is not defined');
      return;
    }
    
    mapboxgl.accessToken = window.MAPBOX_ACCESS_TOKEN;
    
    // Загружаем локальный стиль из JSON файла
    const styleData = await this.loadStyle();
    
    // Рассчитываем zoom на основе ширины контейнера для правильной подстройки глобуса
    const container = document.getElementById(this.config.CONTAINER_ID);
    const containerWidth = container ? container.offsetWidth : 1000;
    // Формула для расчета zoom: zoom = log2(containerWidth / 256)
    // Это обеспечивает, что глобус точно подстраивается под ширину контейнера
    const calculatedZoom = Math.log2(containerWidth / 256);
    
    this.map = new mapboxgl.Map({
      container: this.config.CONTAINER_ID,
      style: styleData, // Используем загруженный локальный стиль
      center: this.config.INITIAL_CENTER,
      zoom: calculatedZoom,
      pitch: 0, // Фиксируем pitch на 0 для ортографического вида (статичная окружность)
      bearing: 0, // Фиксируем bearing на 0 для стабильности
      pitchWithRotate: false, // КРИТИЧНО: отключает изменение pitch при вращении/панорамировании (решение из issue #11353)
      renderWorldCopies: false, // Отключаем дублирование карты
      attributionControl: false, // Убираем attribution для чистоты
      minZoom: calculatedZoom,
      maxZoom: calculatedZoom
    });
    
    await new Promise((resolve) => this.map.on('load', resolve));
    
    // ФАЗА 2: Отключаем все интерактивные элементы кроме drag
    this.disableMapControls();
    
    // Фиксируем pitch на 0 для ортографического вида (статичная окружность)
    this.fixPitch();
    
    // Исправление дерганого скролла: перехватываем wheel события на canvas
    this.preventWheelInterference();
    
    // Настраиваем padding для идеального центрирования глобуса
    this.centerGlobe();
    
    // УБРАНО: Вызов map.resize() при каждом idle вызывал пересчет позиции и размера глобуса,
    // что приводило к визуальному "прыжку" после взаимодействия.
    // map.resize() уже вызывается в centerGlobe() и при изменении размера окна, этого достаточно.
    
    // Пересчитываем центрирование при изменении размера окна
    window.addEventListener('resize', () => {
      this.centerGlobe();
    });
    
    // Отслеживание изменений zoom и pitch при drag и предотвращение автоматического зумирования
    this.preventAutoZoom();
    
    // ОГРАНИЧЕНИЕ ВЕРТИКАЛЬНОГО ВРАЩЕНИЯ: предотвращаем прокрутку к полюсам
    this.limitVerticalRotation();
    
    // ФИКСАЦИЯ ПРОЕКЦИИ: предотвращаем автоматическое зумирование при прокрутке к полюсам
    // Пробуем установить фиксацию несколько раз для надежности
    const tryFixProjectionScaler = () => {
      const fixed = this.fixProjectionScaler();
      if (!fixed) {
        // Если не удалось, пробуем еще раз через небольшой интервал
        setTimeout(() => {
          tryFixProjectionScaler();
        }, 100);
      }
    };
    
    // Пробуем установить сразу после загрузки
    requestAnimationFrame(() => {
      tryFixProjectionScaler();
    });
    
    // Также пробуем установить после первого idle события для надежности
    this.map.once('idle', () => {
      requestAnimationFrame(() => {
        tryFixProjectionScaler();
      });
    });
    
    // ФАЗА 3: Инициализация стран
    this.countriesManager = new CountriesManager(this.map, this.config);
    this.countriesManager.loadFromDOM();
    this.countriesManager.highlightCountries();
    
    console.log('✅ Map initialized successfully');
    console.log('✅ Drag is enabled by default');
    console.log('✅ Scroll zoom disabled');
    console.log('✅ Globe centered in square container');
    console.log(`✅ Initial center: [${this.config.INITIAL_CENTER[0]}, ${this.config.INITIAL_CENTER[1]}] (equator, Europe longitude)`);
    console.log(`✅ Latitude limits: ${this.config.LATITUDE_MIN}° to ${this.config.LATITUDE_MAX}°`);
  }
  
  /**
   * Предотвращает конфликт wheel событий между скроллом страницы и картой
   * Управляет pointer-events на canvas для корректной работы drag
   */
  preventWheelInterference() {
    const container = document.getElementById(this.config.CONTAINER_ID);
    if (!container) return;
    
    const canvas = container.querySelector('.mapboxgl-canvas');
    if (!canvas) return;
    
    // Устанавливаем pointer-events: none на canvas по умолчанию
    // Это предотвращает перехват wheel событий Mapbox
    canvas.style.pointerEvents = 'none';
    
    let scrollTimeout = null;
    let isMouseOverMap = false;
    let isDragging = false;
    const SCROLL_DELAY_MS = 2000; // 2 секунды
    
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
    
    // Обработка wheel событий - при скролле отключаем pointer-events
    container.addEventListener('wheel', () => {
      disablePointerEvents();
      resetScrollTimer();
    }, { passive: true });
    
    // Отслеживаем, когда мышь находится над картой
    container.addEventListener('mouseenter', () => {
      isMouseOverMap = true;
      if (!scrollTimeout) {
        resetScrollTimer();
      }
    });
    
    container.addEventListener('mouseleave', () => {
      isMouseOverMap = false;
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
      }
      if (!isDragging) {
        disablePointerEvents();
      }
    });
    
    // Включаем pointer-events при начале drag
    container.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Левая кнопка мыши
        isDragging = true;
        canvas.style.pointerEvents = 'auto';
      }
    });
    
    // Отключаем pointer-events после окончания drag
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (!isMouseOverMap) {
          disablePointerEvents();
        } else {
          resetScrollTimer();
        }
      }
    });
  }
  
  /**
   * Настраивает центрирование глобуса и обновляет размеры карты
   */
  centerGlobe() {
    const container = document.getElementById(this.config.CONTAINER_ID);
    if (!container || !this.map) return;
    
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    
    // Проверяем, что контейнер имеет валидные размеры
    if (width === 0 || height === 0) {
      console.warn('⚠️ Container has zero dimensions, skipping resize');
      return;
    }
    
    // Рассчитываем zoom на основе ширины контейнера
    // Формула: zoom = log2(containerWidth / 256)
    const targetZoom = Math.log2(width / 256);
    const currentZoom = this.map.getZoom();
    
    // Устанавливаем zoom для подстройки под ширину контейнера
    // Временно отключаем preventAutoZoom, чтобы избежать конфликта
    if (this._setProgrammaticZoomChange) {
      this._setProgrammaticZoomChange(true);
    }
    
    if (Math.abs(currentZoom - targetZoom) > 0.001) {
      // Используем easeTo для более плавного перехода и предотвращения конфликтов
      this.map.easeTo({
        zoom: targetZoom,
        duration: 0,
        essential: true
      });
      this.map.setMinZoom(targetZoom);
      this.map.setMaxZoom(targetZoom);
    }
    
    // Включаем обратно preventAutoZoom после небольшой задержки
    if (this._setProgrammaticZoomChange) {
      requestAnimationFrame(() => {
        this._setProgrammaticZoomChange(false);
      });
    }
    
    // Фиксируем pitch на 0
    const currentPitch = this.map.getPitch();
    if (Math.abs(currentPitch) > 0.001) {
      this.map.setPitch(0);
    }
    
    // Убираем padding для прижатия глобуса к верхней границе контейнера
    this.map.setPadding({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    });
    
    // Принудительно обновляем размеры карты
    requestAnimationFrame(() => {
      if (this.map) {
        this.map.resize();
      }
    });
    
    console.log(`📐 Container size: ${width}x${height}px`);
  }
}

// ФАЗА 3: COUNTRIES MANAGER
class CountriesManager {
  constructor(map, config) {
    this.map = map;
    this.config = config;
    this.countries = [];
  }
  
  loadFromDOM() {
    const items = document.querySelectorAll(`[${this.config.ATTRIBUTES.COUNTRY_ITEM}]`);
    this.countries = Array.from(items).map(item => ({
      name: item.getAttribute(this.config.ATTRIBUTES.COUNTRY_NAME),
      iso: item.getAttribute(this.config.ATTRIBUTES.COUNTRY_ISO)
    }));
    
    console.log(`📍 Loaded ${this.countries.length} countries:`, this.countries.map(c => `${c.name} (${c.iso})`));
    return this.countries;
  }
  
  highlightCountries() {
    if (this.countries.length === 0) {
      console.warn('⚠️ No countries to highlight');
      return;
    }
    
    // Используем ISO коды напрямую из DOM
    const countryISOs = this.countries.map(c => c.iso).filter(iso => iso);
    
    // Проверяем, существуют ли слои, и удаляем их если нужно
    if (this.map.getLayer('highlighted-countries')) {
      this.map.removeLayer('highlighted-countries');
    }
    if (this.map.getLayer('highlighted-countries-stroke')) {
      this.map.removeLayer('highlighted-countries-stroke');
    }
    
    // Проблема: слой admin содержит только линии границ (LineString), а не полигоны стран
    // Решение: используем внешний GeoJSON источник с данными стран
    const countriesGeoJSONSourceId = 'countries-geojson';
    
    // Проверяем, существует ли уже источник
    if (!this.map.getSource(countriesGeoJSONSourceId)) {
      // Отключаем упрощение геометрии для максимальной детализации
      this.map.addSource(countriesGeoJSONSourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        },
        // Отключаем упрощение геометрии - используем все точки без упрощения
        tolerance: 0
      });
      
      // Загружаем максимально детализированные данные стран (Natural Earth 10m)
      // Используем источники с максимальным разрешением
      this.loadHighDetailGeoJSON(countriesGeoJSONSourceId, countryISOs);
    }
    
    const layerConfig = {
      id: 'highlighted-countries',
      type: 'fill',
      source: countriesGeoJSONSourceId,
      filter: [
        'in',
        ['get', 'adm0_a3'],
        ['literal', countryISOs]
      ],
      paint: {
        'fill-color': this.config.COUNTRY_COLOR,
        'fill-opacity': this.config.COUNTRY_FILL_OPACITY
      }
    };
    
    // Добавляем слой обводки для лучшей видимости границ
    const strokeLayerConfig = {
      id: 'highlighted-countries-stroke',
      type: 'line',
      source: countriesGeoJSONSourceId,
      filter: [
        'in',
        ['get', 'adm0_a3'],
        ['literal', countryISOs]
      ],
      paint: {
        'line-color': this.config.COUNTRY_STROKE_COLOR,
        'line-width': this.config.COUNTRY_STROKE_WIDTH,
        'line-opacity': 0.8
      }
    };
    
    try {
      // Добавляем слой для закрашивания стран перед слоем границ
      const adminCountryLayer = this.map.getLayer('admin-country');
      const beforeLayer = adminCountryLayer ? 'admin-country' : undefined;
      this.map.addLayer(layerConfig, beforeLayer);
      
      // Добавляем слой обводки поверх заливки
      this.map.addLayer(strokeLayerConfig, beforeLayer);
      
      console.log('✅ Countries highlighted with high-detail borders');
    } catch (error) {
      console.error('❌ Failed to add layer:', error);
      throw error;
    }
  }
  
  async loadHighDetailGeoJSON(sourceId, countryISOs) {
    // Используем официальные источники Natural Earth через CloudFront CDN
    // Такие же источники используются в проекте Map-dots для максимальной детализации
    const sources = [
      // Попытка 1: Natural Earth 10m - максимальная детализация (официальный источник)
      'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_10m_admin_0_countries.geojson',
      // Попытка 2: Natural Earth 50m - хороший баланс (официальный источник, как в Map-dots)
      'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_countries.geojson',
      // Попытка 3: Natural Earth 110m - fallback (официальный источник)
      'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson',
      // Попытка 4: Альтернативный источник через GitHub (если CloudFront недоступен)
      'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson'
    ];
    
    let loaded = false;
    
    for (const url of sources) {
      try {
        console.log(`📍 Trying to load GeoJSON from: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
          console.warn(`⚠️ Failed to fetch from ${url}: ${response.statusText}`);
          continue;
        }
        
        let data = await response.json();
        
        // Обрабатываем разные форматы GeoJSON
        // Если это TopoJSON, пытаемся извлечь данные
        if (data.type === 'Topology' && data.objects) {
          // Это TopoJSON - пытаемся извлечь объекты
          // TopoJSON может содержать более детализированные данные
          try {
            // Если есть библиотека topojson, можно конвертировать
            // Пока пропускаем и пробуем следующий источник
            console.warn('⚠️ TopoJSON format detected, trying next source...');
            continue;
          } catch (e) {
            console.warn('⚠️ TopoJSON conversion failed, trying next source...');
            continue;
          }
        }
        
        // Если это не FeatureCollection, пытаемся извлечь features
        if (data.type !== 'FeatureCollection') {
          if (data.features) {
            data = { type: 'FeatureCollection', features: data.features };
          } else {
            console.warn('⚠️ Unexpected GeoJSON format, trying next source...');
            continue;
          }
        }
        
        // Natural Earth использует ISO_A3 (3 буквы) в поле adm0_a3
        // ISO коды из DOM уже в формате ISO_A3, просто нормализуем поле в GeoJSON
        // Никакого маппинга не требуется - используем ISO_A3 напрямую
        data.features = data.features.map(feature => {
          const props = feature.properties || {};
          
          // Natural Earth использует ISO_A3 в поле adm0_a3
          // Убеждаемся, что поле нормализовано для фильтрации
          const isoA3 = props.adm0_a3 || props.ISO_A3 || props.iso_a3 || props.ADM0_A3;
          
          // Сохраняем ISO_A3 в поле adm0_a3 для фильтрации
          // Фильтрация происходит по ISO_A3 кодам из DOM (data-map-country-iso)
          if (isoA3) {
            props.adm0_a3 = isoA3;
          }
          
          return feature;
        });
        
        // Подсчитываем общее количество координат для оценки детализации
        let totalCoordinates = 0;
        const countCoords = (coords) => {
          if (!Array.isArray(coords)) return 0;
          if (coords.length === 0) return 0;
          // Если первый элемент - число, это массив координат [lng, lat]
          if (typeof coords[0] === 'number') {
            return coords.length / 2; // Каждая координата = 2 числа
          }
          // Иначе рекурсивно считаем вложенные массивы
          return coords.reduce((sum, c) => sum + countCoords(c), 0);
        };
        
        data.features.forEach(feature => {
          if (feature.geometry && feature.geometry.coordinates) {
            totalCoordinates += countCoords(feature.geometry.coordinates);
          }
        });
        
        // Проверяем качество источника по количеству координат
        const isHighDetail = totalCoordinates >= this.config.MIN_COORDINATES_THRESHOLD;
        
        if (!isHighDetail && sources.indexOf(url) < sources.length - 1) {
          // Если детализация низкая и есть еще источники, пробуем следующий
          console.log(`⚠️ Low detail source (${totalCoordinates.toLocaleString()} coords), trying next...`);
          continue;
        }
        
        // Обновляем источник с загруженными данными
        // Убеждаемся, что упрощение отключено
        const source = this.map.getSource(sourceId);
        source.setData(data);
        
        // Обновляем фильтр слоя после загрузки данных
        if (this.map.getLayer('highlighted-countries')) {
          this.map.setFilter('highlighted-countries', [
            'in',
            ['get', 'adm0_a3'],
            ['literal', countryISOs]
          ]);
          
          this.map.setFilter('highlighted-countries-stroke', [
            'in',
            ['get', 'adm0_a3'],
            ['literal', countryISOs]
          ]);
        }
        
        console.log(`✅ Loaded ${isHighDetail ? 'HIGH-DETAIL' : 'standard'} GeoJSON from: ${url}`);
        console.log(`📍 Total features: ${data.features.length}`);
        console.log(`📍 Total coordinates: ${totalCoordinates.toLocaleString()} (higher = smoother borders)`);
        loaded = true;
        break;
        
      } catch (error) {
        console.warn(`⚠️ Error loading from ${url}:`, error.message);
        continue;
      }
    }
    
    if (!loaded) {
      console.error('❌ Failed to load GeoJSON from all sources');
      // Используем fallback - загружаем базовый источник
      this.loadFallbackGeoJSON(sourceId, countryISOs);
    }
  }
  
  async loadFallbackGeoJSON(sourceId, countryISOs) {
    // Fallback на оригинальный источник
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
      
      if (this.map.getLayer('highlighted-countries')) {
        this.map.setFilter('highlighted-countries', [
          'in',
          ['get', 'ISO_A2'],
          ['literal', countryISOs]
        ]);
        
        this.map.setFilter('highlighted-countries-stroke', [
          'in',
          ['get', 'ISO_A2'],
          ['literal', countryISOs]
        ]);
      }
      
      console.log('✅ Loaded fallback GeoJSON');
    } catch (error) {
      console.error('❌ Failed to load fallback GeoJSON:', error);
    }
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