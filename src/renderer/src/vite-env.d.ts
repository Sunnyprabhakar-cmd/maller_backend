/// <reference types="vite/client" />
import type { MaigunApi } from '../../preload/index'

declare global {
  interface Window {
    maigun: MaigunApi
  }
}

export {}
