// WebSocket client for realtime events
import { io, Socket } from 'socket.io-client'

const DEFAULT_WS_URL = process.env.REACT_APP_WS_URL || 'https://maller-backend-1.onrender.com'

export class WebSocketClient {
  private socket: Socket | null = null
  private wsUrl: string
  private listeners: Record<string, Function[]> = {}

  constructor(wsUrl: string = DEFAULT_WS_URL) {
    this.wsUrl = wsUrl
  }

  connect() {
    if (this.socket?.connected) {
      return this.socket
    }

    this.socket = io(this.wsUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    })

    this.socket.on('connect', () => {
      console.log('[WebSocket] Connected to backend')
      this.emit('connected')
    })

    this.socket.on('disconnect', () => {
      console.log('[WebSocket] Disconnected from backend')
      this.emit('disconnected')
    })

    // Listen for all events
    this.socket.on('email:sent', (data) => {
      this.emit('email:sent', data)
    })

    this.socket.on('email:failed', (data) => {
      this.emit('email:failed', data)
    })

    this.socket.on('webhook:event', (data) => {
      this.emit('webhook:event', data)
    })

    return this.socket
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)

    return () => {
      // Return unsubscribe function
      this.listeners[event] = this.listeners[event].filter(
        (cb) => cb !== callback
      )
    }
  }

  private emit(event: string, data?: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((callback) => callback(data))
    }
  }
}

export const wsClient = new WebSocketClient()
