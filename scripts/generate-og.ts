// Renders static/og.png (1200×630) from an inline SVG — the radar brand mark
// scaled up with a wordmark. Run locally and commit the PNG:
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

  <rect width="1200" height="630" fill="#0a0a0b"/>

  <!-- Radar mark, left side (center 330,315; scale ≈ favicon ×5) -->
  <g>
    <circle cx="330" cy="315" r="190" fill="none" stroke="#52525b" stroke-width="14"/>
    <circle cx="330" cy="315" r="115" fill="none" stroke="#52525b" stroke-width="8" opacity="0.45"/>
    <path d="M330 315 L464.3 180.7 A190 190 0 0 0 195.7 180.7 Z" fill="url(#sweep)"/>
    <line x1="330" y1="315" x2="464.3" y2="180.7" stroke="#60a5fa" stroke-width="18" stroke-linecap="round"/>
    <circle cx="330" cy="315" r="16" fill="#a1a1aa"/>
    <circle cx="378" cy="196" r="78" fill="url(#blip-glow)"/>
    <circle cx="378" cy="196" r="48" fill="none" stroke="#ef4444" stroke-width="9" opacity="0.45"/>
    <circle cx="378" cy="196" r="26" fill="#ef4444"/>
  </g>

  <!-- Wordmark + tagline -->
  <text x="600" y="300" font-family="Segoe UI, Arial, sans-serif" font-size="92" font-weight="800" fill="#ffffff" letter-spacing="-2">WW3Watch</text>
  <text x="602" y="362" font-family="Segoe UI, Arial, sans-serif" font-size="34" fill="#9ca3af">Real-time global conflict tracker</text>
  <text x="602" y="426" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#52525b">200 sources · every region · every perspective</text>
</svg>`

const png = await sharp(Buffer.from(svg)).png().toBuffer()
writeFileSync('static/og.png', png)
console.log(`static/og.png written (${png.length} bytes)`)
