// Renders static/og.png (1200×630) from an inline SVG — the radar brand mark
// with a serif wordmark, in the app's theme (src/app.css tokens). Run locally and commit the PNG:
//   node --import tsx scripts/generate-og.ts
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

const svg = `<svg viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sweep" x1="465" y1="155" x2="195" y2="155" gradientUnits="userSpaceOnUse">
      <stop offset="0"    stop-color="#3b82f6" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="#3b82f6" stop-opacity="0.16"/>
      <stop offset="1"    stop-color="#3b82f6" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="blip-glow">
      <stop offset="0" stop-color="#ef4444" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#ef4444" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- The app's night ground (color-ink) with a hairline frame, like its panels. -->
  <rect width="1200" height="630" fill="#070809"/>
  <rect x="40" y="40" width="1120" height="550" rx="28" fill="#0e1013" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2"/>

  <!-- Radar mark (center 300,315) -->
  <g>
    <circle cx="300" cy="315" r="150" fill="none" stroke="#52525b" stroke-width="11"/>
    <circle cx="300" cy="315" r="91" fill="none" stroke="#52525b" stroke-width="6" opacity="0.45"/>
    <path d="M300 315 L406 209 A150 150 0 0 0 194 209 Z" fill="url(#sweep)"/>
    <line x1="300" y1="315" x2="406" y2="209" stroke="#60a5fa" stroke-width="14" stroke-linecap="round"/>
    <circle cx="300" cy="315" r="12" fill="#a1a1aa"/>
    <circle cx="338" cy="221" r="62" fill="url(#blip-glow)"/>
    <circle cx="338" cy="221" r="38" fill="none" stroke="#ef4444" stroke-width="7" opacity="0.45"/>
    <circle cx="338" cy="221" r="21" fill="#ef4444"/>
  </g>

  <!-- Serif wordmark like the app's headlines; sans around it. -->
  <text x="530" y="300" font-family="Georgia, 'Times New Roman', serif" font-size="96" font-weight="500" fill="#f1f2f4" letter-spacing="-1.5">WW3Watch</text>
  <rect x="532" y="334" width="72" height="3" rx="1.5" fill="#8fb4f5"/>
  <text x="532" y="392" font-family="Segoe UI, Arial, sans-serif" font-size="32" fill="#a4a9b1">Conflict reporting from every side,</text>
  <text x="532" y="436" font-family="Segoe UI, Arial, sans-serif" font-size="32" fill="#a4a9b1">side by side.</text>
</svg>`

const png = await sharp(Buffer.from(svg)).png().toBuffer()
writeFileSync('static/og.png', png)
console.log(`static/og.png written (${png.length} bytes)`)
