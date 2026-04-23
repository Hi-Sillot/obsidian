import { App } from 'vue';
import * as TDesign from 'tdesign-mobile-vue';

export function setupTDesignMobile(app: App) {
  app.use(TDesign);
  return app;
}

export const TDesignMobile = TDesign;
