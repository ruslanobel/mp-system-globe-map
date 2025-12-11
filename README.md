# MP System Globe Map

Интерактивная глобусная карта для Webflow сайта MP System с использованием Mapbox GL JS.

## 🚀 Быстрый старт

### Подключение к Webflow

Добавьте этот тег в Custom Code вашего Webflow сайта:

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/ВАШ_GITHUB_USERNAME/mp-system-globe-map@latest/script.js"></script>
```

**Важно:** После первого пуша замените `ВАШ_GITHUB_USERNAME` на ваш реальный GitHub username.

### Конфигурация

Убедитесь, что на странице Webflow определена переменная:

```javascript
window.MAPBOX_ACCESS_TOKEN = 'ваш_токен';
```

И существует элемент с ID:

```html
<div id="globe-map"></div>
```

## 🔄 Workflow для обновлений

Простой процесс обновления скрипта:

```bash
# 1. Редактируете script.js локально
# 2. Коммитите изменения
git add script.js
git commit -m "Описание изменений"

# 3. Пушите на GitHub
git push origin main
```

**Готово!** jsDelivr CDN автоматически подхватит изменения в течение 1-5 минут.

### Принудительное обновление кэша

Если нужно обновить кэш немедленно:

```html
<!-- Используйте версию с конкретным коммитом -->
<script type="module" src="https://cdn.jsdelivr.net/gh/ВАШ_USERNAME/mp-system-globe-map@COMMIT_SHA/script.js"></script>
```

Или очистите кэш jsDelivr: https://www.jsdelivr.com/tools/purge

## 📦 Структура проекта

```
.
├── script.js           # Основной скрипт карты
├── collections/        # CSV данные для маркеров
│   ├── MP System - Map _ Countries.csv
│   └── MP System - Map _ Offices.csv
├── style.json          # Конфигурация стиля Mapbox
└── README.md          # Документация
```

## 🛠 Разработка

### Локальное тестирование

1. Установите Live Server расширение в VS Code
2. Откройте `index.html` через Live Server
3. Карта будет доступна на `http://127.0.0.1:5500`

### Отладка на Webflow Staging

После пуша на GitHub используйте jsDelivr URL в Webflow Custom Code для тестирования.

## 📝 Конфигурация карты

Настройки находятся в `script.js`:

```javascript
const CONFIG = {
  MAPBOX_STYLE: 'mapbox://styles/ruslan-obel/cmit1vgga002501s612mlecmi',
  CONTAINER_ID: 'globe-map',
  INITIAL_CENTER: [13.4, 52.5], // Берлин (центр Европы)
  INITIAL_ZOOM: 3.5
};
```

## 🔗 Ссылки

- [Mapbox GL JS Docs](https://docs.mapbox.com/mapbox-gl-js/api/)
- [jsDelivr CDN](https://www.jsdelivr.com/)
- [Webflow Custom Code](https://university.webflow.com/lesson/custom-code-in-the-head-and-body-tags)

## 📄 Лицензия

Частный проект MP System
