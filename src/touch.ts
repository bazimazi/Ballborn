import type { Input, TouchAction } from './input'

/** Stick travel in CSS pixels for full tilt. */
const STICK_RADIUS = 52
const STICK_DEADZONE = 0.18

/**
 * On-screen controls for touch screens: a floating stick that appears where
 * the left thumb lands, a hop button, and the ability dial as a button. The
 * pause and build buttons in the HUD also work with a mouse.
 */
export function attachTouchControls(input: Input, root: HTMLElement): void {
  const zone = root.querySelector<HTMLElement>('[data-touch-stick]')
  const base = root.querySelector<HTMLElement>('.stick-base')
  const knob = root.querySelector<HTMLElement>('.stick-knob')
  if (zone && base && knob) {
    let id: number | null = null
    let ox = 0
    let oy = 0
    const place = (x: number, y: number) => {
      const r = zone.getBoundingClientRect()
      base.style.left = `${x - r.left}px`
      base.style.top = `${y - r.top}px`
    }
    const move = (x: number, y: number) => {
      let dx = (x - ox) / STICK_RADIUS
      let dy = (y - oy) / STICK_RADIUS
      const mag = Math.hypot(dx, dy)
      if (mag > 1) {
        dx /= mag
        dy /= mag
      }
      knob.style.transform = `translate(${(dx * STICK_RADIUS).toFixed(1)}px, ${(dy * STICK_RADIUS).toFixed(1)}px)`
      const ax = Math.abs(dx) < STICK_DEADZONE ? 0 : Math.sign(dx) * Math.min(1, (Math.abs(dx) - STICK_DEADZONE) / (1 - STICK_DEADZONE) * 1.15)
      input.touchStick(ax, dy)
    }
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      id = null
      zone.classList.remove('held')
      knob.style.transform = ''
      base.style.left = ''
      base.style.top = ''
      input.touchStick(0, 0)
    }
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return
      e.preventDefault()
      id = e.pointerId
      ox = e.clientX
      oy = e.clientY
      try {
        zone.setPointerCapture(e.pointerId)
      } catch {
        // Capture keeps the stick alive off the zone; without it the stick still works inside.
      }
      zone.classList.add('held')
      place(ox, oy)
      move(ox, oy)
    })
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return
      // The base follows a thumb that drags far past it, so reversing is instant.
      const dx = e.clientX - ox
      const dy = e.clientY - oy
      const mag = Math.hypot(dx, dy)
      if (mag > STICK_RADIUS * 1.35) {
        const k = (mag - STICK_RADIUS * 1.35) / mag
        ox += dx * k
        oy += dy * k
        place(ox, oy)
      }
      move(e.clientX, e.clientY)
    })
    zone.addEventListener('pointerup', end)
    zone.addEventListener('pointercancel', end)
    zone.addEventListener('lostpointercapture', end)
  }

  // Buttons are found by delegation, so ones rendered later (the sheet's close button) work too.
  const held = new Map<number, HTMLElement>()
  const release = (e: PointerEvent) => {
    const el = held.get(e.pointerId)
    if (!el) return
    held.delete(e.pointerId)
    if (![...held.values()].includes(el)) {
      el.classList.remove('down')
      input.touchButton(el.dataset.touch as TouchAction, false)
    }
  }
  root.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-touch]')
    if (!el || !root.contains(el)) return
    e.preventDefault()
    held.set(e.pointerId, el)
    el.classList.add('down')
    input.touchButton(el.dataset.touch as TouchAction, true)
  })
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', release)
  // Keyboard activation of a HUD button would double up with gameplay keys.
  root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-touch]')) e.preventDefault()
  })
  root.addEventListener('contextmenu', (e) => e.preventDefault())
}
