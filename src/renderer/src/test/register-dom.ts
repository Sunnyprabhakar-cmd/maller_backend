import { JSDOM } from '../../../../backend/node_modules/jsdom/lib/api.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/'
})

globalThis.window = dom.window as unknown as Window & typeof globalThis
globalThis.document = dom.window.document

Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true
})

Object.defineProperty(globalThis, 'HTMLElement', {
  value: dom.window.HTMLElement,
  configurable: true
})

Object.defineProperty(globalThis, 'HTMLInputElement', {
  value: dom.window.HTMLInputElement,
  configurable: true
})

Object.defineProperty(globalThis, 'HTMLButtonElement', {
  value: dom.window.HTMLButtonElement,
  configurable: true
})

Object.defineProperty(globalThis, 'HTMLIFrameElement', {
  value: dom.window.HTMLIFrameElement,
  configurable: true
})

Object.defineProperty(globalThis, 'Event', {
  value: dom.window.Event,
  configurable: true
})
