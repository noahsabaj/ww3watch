// Regenerates the PNG icon set + favicon.ico from static/favicon.svg:
//   npx pwa-assets-generator
// (minimal-2023 preset emits exactly the filenames vite.config.ts references:
// pwa-64/192/512, maskable-icon-512, apple-touch-icon-180, favicon.ico.)
// Apple/maskable padding is filled with the brand background instead of the
// preset's default white.
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { background: '#0a0a0b' },
    },
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { background: '#0a0a0b' },
    },
  },
  images: ['static/favicon.svg'],
})
