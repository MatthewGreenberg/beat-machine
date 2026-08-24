import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

const vercelHost = process.env.VERCEL_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL
const siteOrigin = vercelHost ? `https://${vercelHost}` : ''

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    {
      name: 'site-origin',
      transformIndexHtml: (html) => html.replaceAll('%SITE_ORIGIN%', siteOrigin),
    },
  ],
})
