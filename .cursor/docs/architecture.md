# Архитектура проекта MP System Map

## Обзор

MP System Map — интерактивная карта-глобус для Webflow, построенная на Mapbox GL JS. Сцена рендерится в ортографической проекции, подсвечивает список стран и отображает офисы с кастомными HTML-маркерами и модальными окнами. Вся логика живет в `script.js`, данные берутся из DOM через data-атрибуты, а стиль карты загружается напрямую из Mapbox Studio (`mapbox://styles/ruslan-obel/cmit1vgga002501s612mlecmi`). Основные задачи движка — удерживать фиксированный масштаб, ограничивать вертикальное вращение, синхронизировать работу tooltip'ов/модалок и корректно обрабатывать асинхронную загрузку контента Webflow.

## Основные компоненты

### MapController
Оркестратор, создающий и настраивающий карту:
- применяет стиль из Mapbox Studio и рассчитывает zoom по размеру контейнера (`calculateGlobeZoom`)
- ограничивает интерактивность (только drag) и управляет pointer-events, чтобы скролл страницы не конфликтовал с canvas
- фиксирует zoom/pitch, ограничивает широту `[-30°, 30°]`, патчит `cameraToCenterDistance`/`_pixelsPerMercatorPixel`, чтобы Mapbox не менял масштаб у полюсов
- пересчитывает zoom при `resize`, «оживляет» projection scaler для корректного `map.resize()`, синхронизирует `preventAutoZoom` через `_updateTargetZoom`
- запускает анимацию выравнивания глобуса при появлении секции (`setupScrollAnimation`)
- инициализирует `CountriesManager`, `OfficesManager`, `ModalManager`, `TooltipManager`, а также `GeocodingService`, ожидая появления офисов в DOM (`waitForOfficeElements`)

### CountriesManager
- читает список стран из DOM (`data-map-country-item`, `data-map-country-iso`)
- добавляет общий источник `countries-geojson` и подкачивает границы из Natural Earth с попытками по убыванию детализации
- нормализует ISO-коды, подсчитывает количество координат и выбирает первый достаточно детализированный источник
- рендерит два слоя: заливку (`highlighted-countries`) и обводку (`highlighted-countries-stroke`)

### GeocodingService
- оборачивает Mapbox Geocoding API, кеширует координаты адресов, чтобы не дублировать запросы
- используется только `OfficesManager` и принимает access token от главного контроллера

### OfficesManager
- ждет элементы с `data-map-office-address`, геокодирует каждый адрес, хранит ссылку на исходный DOM-элемент
- клонирует HTML-пин, превращает его в `mapboxgl.Marker`, и добавляет кликовый обработчик
- пробрасывает клики в `ModalManager`, передавая координаты маркера на экране

### ModalManager
- ищет модальное окно внутри элемента офиса, переносит его в `body` для абсолютного позиционирования
- заполняет контент по атрибутам (`data-map-office-name` и т.д.), настраивает кнопку закрытия и следит за кликом по карте/маркерам
- управляет `map.dragPan` при открытии/закрытии, хранит ссылки для восстановления DOM-иерархии

### TooltipManager
- использует шаблон tooltip'а из списка стран или общий элемент с `data-map-tooltip`
- при наведении на слой `highlighted-countries` определяет страну, вытягивает кастомный tooltip из DOM и позиционирует его относительно курсора
- скрывает tooltip при уходе мыши, скролле или отсутствии совпадений

## Конфигурация (`CONFIG`)
- `STYLE_URL` — Mapbox Studio стиль, применяемый при инициализации
- `INITIAL_CENTER`, `INITIAL_LATITUDE_OFFSET` — стартовая позиция и наклон, чтобы анимация возвращалась к Европе
- `LATITUDE_MIN`, `LATITUDE_MAX`, `ENABLE_PROJECTION_FIX`, `INITIAL_ZOOM` — ограничения вращения и поведения камеры
- `COUNTRIES_GEOJSON_URL`, `MIN_COORDINATES_THRESHOLD` — fallback-источник и порог детальности
- `COUNTRY_*` — визуальные параметры заливки и обводки стран
- `ATTRIBUTES` — единый словарь data-атрибутов для стран, офисов, tooltip'ов и модальных окон

## Поток данных

### Инициализация карты
1. `DOMContentLoaded` → проверка контейнера `#globe-map`.
2. `MapController.init()`:
   - устанавливает `mapboxgl.accessToken`, подставляет стиль из `CONFIG.STYLE_URL`
   - вычисляет zoom по минимальной стороне контейнера, создает карту с `pitch: 0`, `renderWorldCopies: false`, фиксированным zoom
   - отключает стандартные контролы, включает обработчик wheel → pointer-events, подписывается на resize
   - активирует `preventAutoZoom`, `limitVerticalRotation`, `fixProjectionScaler` (c повторными попытками до первого `idle`)

### Страны
1. DOM → `CountriesManager.loadFromDOM()` собирает ISO-коды.
2. `highlightCountries()` создаёт источник и запускает `loadHighDetailGeoJSON`:
   - пробует Natural Earth 10m / 50m / 110m, при ошибке — GitHub-файл Holtzy
   - оценивает детальность по количеству координат, обновляет источник и фильтры слоев.

### Офисы и модалка
1. `waitForOfficeElements()` ждёт, пока Webflow добавит элементы с `data-map-office-address`.
2. `OfficesManager.loadFromDOM()` геокодирует адрес → координаты и сохраняет ссылки на DOM-узлы.
3. `createMarkers()` развешивает кастомные пины и пробрасывает клики в `ModalManager.show()`.
4. `ModalManager` переносит окно в `body`, наполняет содержимое, позиционирует рядом с маркером и блокирует drag.

### Tooltip'ы
1. `TooltipManager.init()` находит шаблон tooltip'а или самостоятельный элемент.
2. `setupMapHover()` слушает `mousemove` по слою `highlighted-countries`, ищет соответствующую страну в DOM и выводит текст/HTML подсказки.

## Структура директорий

```
Map/
├── script.js              # Вся клиентская логика (MapController, менеджеры, сервисы)
├── index.html             # Контейнер карты и скрытые списки стран/офисов
├── style.css              # Оформление контейнера карты, tooltip'ов, модалок, пинов
├── style.json             # Исторический локальный стиль (теперь не используется рантаймом)
├── collections/
│   ├── MP System - Map _ Countries.csv
│   └── MP System - Map _ Offices.csv
└── .cursor/docs/
    └── architecture.md    # Этот документ
```

## Внешние сервисы и данные

### Mapbox GL JS + Mapbox Studio Style
- движок визуализации, загружается из CDN в `index.html`
- стиль подключается по URL `mapbox://...`, что убрало необходимость хранить актуальный JSON в репозитории
- используется globe projection, `renderWorldCopies: false`, `setTerrain(null)`

### Mapbox Geocoding API
- вызывается для каждого `data-map-office-address`
- результаты кешируются в `GeocodingService.cache`, чтобы повторные обращения не шли в сеть

### Natural Earth (CloudFront CDN) + GitHub fallback
- источники `ne_10m`, `ne_50m`, `ne_110m` подкачиваются напрямую
- если CloudFront недоступен или возвращает TopoJSON, используется `D3-graph-gallery` GeoJSON

## Особенности реализации

- **Фиксация масштаба**: `preventAutoZoom` отслеживает любые изменения `zoom/pitch`, мгновенно возвращая их к вычисленному значению. При resize MapController временно снимает ограничения, пересчитывает zoom и снова фиксирует диапазон.
- **Патчинг projection scaler**: `fixProjectionScaler()` переопределяет `cameraToCenterDistance` и `_pixelsPerMercatorPixel` через `Object.defineProperty`, тем самым предотвращает автоматическое уменьшение глобуса возле полюсов. `unfixProjectionScaler()` временно восстанавливает оригинальные дескрипторы, когда нужно пересчитать размеры.
- **Ограничение широты**: `limitVerticalRotation()` следит за `move/drag/moveend`, и если центр выходит за `[-30°, 30°]`, мгновенно возвращает его в пределы.
- **Управление pointer-events**: `preventWheelInterference()` держит canvas в состоянии `pointer-events: none`, пока пользователь просто скроллит страницу, и включает их только на drag/после паузы, чтобы не перехватывать прокрутку.
- **Анимация появления**: IntersectionObserver запускает `easeTo` от начального наклона (`INITIAL_LATITUDE_OFFSET`) к целевому центру, создавая эффект плавного выравнивания глобуса при скролле.
- **Модалки и tooltip'ы**: все шаблоны берутся из DOM, поэтому Webflow редакторы могут изменять содержание без правки JS-кода. Скрипт аккуратно клонирует элементы, сбрасывает обработчики и восстанавливает структуру после закрытия.
