import { defineConfig } from 'vite';
export default defineConfig({ base: './', plugins:[{
  name:'development-styles', apply:'serve',
  transformIndexHtml(html){return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");},
}] });
