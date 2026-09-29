/**
 * Line icons drawn on a 24 px grid, stroked with the current text colour so
 * they follow button states and the high-contrast theme. Menus lean on these
 * instead of words so they read at a glance on a small touch screen.
 */
const PATHS = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  resume: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10 20v-5h4v5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/><circle cx="12" cy="12" r="6.4"/>',
  book: '<path d="M4 5.5c3-1.5 5.5-1.5 8 0v14c-2.5-1.5-5-1.5-8 0z"/><path d="M20 5.5c-3-1.5-5.5-1.5-8 0v14c2.5-1.5 5-1.5 8 0z"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v5.5L4.8 18.2A1.6 1.6 0 0 0 6.2 20.5h11.6a1.6 1.6 0 0 0 1.4-2.3L13.5 9V3.5"/><path d="M7.5 14.5h9"/>',
  flame: '<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.8 3.2-5.6 3.8-9.5 2.3 1.4 3.2 3.3 3.2 5.2 1-.6 1.8-1.8 2-3.2 2.2 1.8 4 4.3 4 7.5 0 3.4-2.5 6-6.5 6z"/>',
  spark: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  hop: '<path d="M12 19V6"/><path d="M6 11.5L12 5.5l6 6"/><path d="M5 20.5h14"/>',
  wrench: '<path d="M14.5 4.2a4.8 4.8 0 0 0-5.7 6.4L3.6 15.8a2 2 0 0 0 2.8 2.8l5.2-5.2a4.8 4.8 0 0 0 6.4-5.7l-2.9 2.9-2.6-.4-.4-2.6z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z"/>',
  gauge: '<path d="M4 16.5a8 8 0 1 1 16 0"/><path d="M12 16.5l4.2-5.2"/><circle cx="12" cy="16.5" r="1.4" fill="currentColor"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  recycle: '<path d="M7 7.5l2.5-4 2.6 4.2"/><path d="M9.5 3.5l-5 8.5 2.4 4"/><path d="M17.5 10l2 3.8-2.2 3.7h-5"/><path d="M14.5 14.8l-2.2 2.7 2.2 2.8"/><path d="M8.5 17.5H5.2"/>',
  swap: '<path d="M5 8.5h13l-3.5-3.5M19 15.5H6l3.5 3.5"/>',
  door: '<path d="M5 20.5h14"/><path d="M7 20.5V4h10v16.5"/><circle cx="14" cy="12.5" r=".9" fill="currentColor"/>',
  exit: '<path d="M14 4.5h5.5v15H14"/><path d="M10.5 8l-4 4 4 4M6.5 12H16"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.5H15"/>',
  trophy: '<path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5c0 3 1.6 4.5 3.7 4.8M16 5.5h3.5c0 3-1.6 4.5-3.7 4.8"/><path d="M12 13.5v3.5M8.5 20h7M9.5 17h5v3h-5z"/>',
  skull: '<path d="M12 3.5c-4.4 0-7.5 3-7.5 7.2 0 2.4 1 4 2.5 5v3.3h10v-3.3c1.5-1 2.5-2.6 2.5-5 0-4.2-3.1-7.2-7.5-7.2z"/><circle cx="9" cy="11" r="1.6" fill="currentColor"/><circle cx="15" cy="11" r="1.6" fill="currentColor"/><path d="M10.5 19v-2M13.5 19v-2"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
  impact: '<path d="M12 2.5l1.8 5.2 5.2-1.8-2.7 4.8 4.9 2.3-5.4 1 .8 5.4-4.6-3-4.6 3 .8-5.4-5.4-1 4.9-2.3L5 5.9l5.2 1.8z"/>',
  combo: '<path d="M5 5l14 14M19 5L5 19"/>',
  map: '<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  flag: '<path d="M5.5 21V3.5"/><path d="M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  hash: '<path d="M9.5 3.5l-2 17M16.5 3.5l-2 17M4 9h16.5M3.5 15H20"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  rotate: '<rect x="3.5" y="7" width="17" height="10" rx="2"/><path d="M8 3.5c3-1 6.5-.5 8.5 1.8M16.5 2.5v2.8h-2.8"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  motion: '<path d="M3.5 8h9M2.5 12h7M3.5 16h9"/><circle cx="17" cy="12" r="4.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.5M9.5 10h.5M13.5 10h.5M17.5 10h.5M7.5 14h9"/>',
  assist: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14"/><path d="M10 10.5v6M14 10.5v6"/>',
  star: '<path d="M12 2.5l2.2 6 6.3.4-4.9 4 1.6 6.1L12 15.6 6.8 19l1.6-6.1-4.9-4 6.3-.4z"/>',
  crown: '<path d="M3.5 18.5h17l-1.6-10-4.4 3.8L12 4.5l-2.5 7.8-4.4-3.8z"/><path d="M8 15h8"/>',
  tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8.5" r="1.4" fill="currentColor"/>',
  question: '<path d="M8.8 8.6a3.3 3.3 0 1 1 4.6 3c-.8.4-1.4 1-1.4 1.9v.8"/><circle cx="12" cy="18.3" r=".6"/>',
  chest: '<path d="M4 10h16v9H4z"/><path d="M4 10l2-4.5h12L20 10"/><path d="M12 12.5v3"/>',
  wave: '<path d="M3 18c3.5-8 10.5-8 14 0"/><path d="M13.5 15l3.5 3 3-3.5"/><circle cx="6" cy="9" r="1.8"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10"/><path d="M8 3.5c0 5 8 4.5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 4.5-8 8.5s8 3.5 8 8.5"/>',
  colossus: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="5.8" r="1"/><circle cx="6.8" cy="15" r="1"/><circle cx="17.2" cy="15" r="1"/>',
  warning: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".6"/>',
  up: '<path d="M12 5l6.5 9h-13z" fill="currentColor" stroke="none"/>',
  down: '<path d="M12 19l6.5-9h-13z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="M4 4l16 16"/>',
} as const

export type IconName = keyof typeof PATHS

/** An inline SVG icon. Decorative by default: label the button, not the icon. */
export function svg(name: IconName, size = 22, cls = ''): string {
  return `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
}
