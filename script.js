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
    
    try {
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
    } catch (error) {
      throw error;
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