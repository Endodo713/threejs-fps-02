// Palette for JADE PASS: mountain shrine pass in a bamboo forest, golden morning mist.
// Deep moss green + bamboo gold-green, vermilion red (torii, lanterns), pale mist sky,
// dark slate stone. Numbers are the render colours; CSS holds the matching hex strings
// for the HUD stylesheet.
export const PALETTE = {
  sky: 0xdfe8dd,
  fog: 0xdfe8dd,
  sun: 0xffe0a8,
  hemiSky: 0xcfe0d8,
  hemiGround: 0x3a4a33,
  moss: 0x4a6b3f,
  bamboo: 0x7fae4e,
  bambooDark: 0x4e7a34,
  vermilion: 0xc23b22,
  vermilionDark: 0x8e2a18,
  slate: 0x3a4148,
  stone: 0x9a938a,
  stoneDark: 0x6e675f,
  wood: 0x8a6a44,
  woodDark: 0x5f4830,
  water: 0x3f7d7a,
  canvas: 0x141a14,
  surface: 0x1e2a1e,
  hairline: 0x33402f,
  ink: 0xeef2e4,
  muted: 0x9aa894,
  accent: 0xe8b13a,
  accentRed: 0xd84a2f,
  teamAttack: 0x2fa8a0,
  teamDefend: 0xd84a2f,
};

// CSS hex strings, same values as PALETTE, for index.html / HUD styling.
export const CSS = {
  sky: '#dfe8dd',
  fog: '#dfe8dd',
  sun: '#ffe0a8',
  hemiSky: '#cfe0d8',
  hemiGround: '#3a4a33',
  moss: '#4a6b3f',
  bamboo: '#7fae4e',
  bambooDark: '#4e7a34',
  vermilion: '#c23b22',
  vermilionDark: '#8e2a18',
  slate: '#3a4148',
  stone: '#9a938a',
  stoneDark: '#6e675f',
  wood: '#8a6a44',
  woodDark: '#5f4830',
  water: '#3f7d7a',
  canvas: '#141a14',
  surface: '#1e2a1e',
  hairline: '#33402f',
  ink: '#eef2e4',
  muted: '#9aa894',
  accent: '#e8b13a',
  accentRed: '#d84a2f',
  teamAttack: '#2fa8a0',
  teamDefend: '#d84a2f',
};

// CSS custom-property block, handy for index.html: `:root { --sky: #dfe8dd; ... }`.
export const CSS_VARS = Object.keys(CSS)
  .map((name) => `  --${name}: ${CSS[name]};`)
  .join('\n');

export function css(name) {
  return CSS[name];
}

export function shade(name) {
  return PALETTE[name];
}
