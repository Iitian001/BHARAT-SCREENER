/**
 * Angel One SmartAPI WebSocket Service
 * Provides real-time tick-by-tick data streaming
 */

const WebSocket = require('ws')
const EventEmitter = require('events')

class AngelOneWebSocket extends EventEmitter {
  constructor(config) {
    super()
    this.apiKey = config.apiKey
    this.clientCode = config.clientCode
    this.jwtToken = config.jwtToken
    this.feedToken = config.feedToken
    
    this.ws = null
    this.isConnected = false
    this.subscriptions = new Set()
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.pingInterval = null
  }

  /**
   * Connect to Angel One WebSocket
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${this.clientCode}&feedToken=${this.feedToken}&apiKey=${this.apiKey}`
        
        console.log('🔌 Connecting to Angel One WebSocket...')
        this.ws = new WebSocket(wsUrl)
        
        this.ws.on('open', () => {
          console.log('✅ Angel One WebSocket connected')
          this.isConnected = true
          this.reconnectAttempts = 0
          
          // Start ping to keep connection alive
          this.startPing()
          
          // Resubscribe to previous subscriptions
          if (this.subscriptions.size > 0) {
            this.subscribe(Array.from(this.subscriptions))
          }
          
          this.emit('connected')
          resolve()
        })
        
        this.ws.on('message', (data) => {
          try {
            const parsed = this.parseTickData(data)
            if (parsed) {
              this.emit('tick', parsed)
            }
          } catch (err) {
            console.error('Error parsing tick:', err.message)
          }
        })
        
        this.ws.on('error', (error) => {
          console.error('❌ WebSocket error:', error.message)
          this.emit('error', error)
          reject(error)
        })
        
        this.ws.on('close', () => {
          console.log('🔴 WebSocket disconnected')
          this.isConnected = false
          this.stopPing()
          this.emit('disconnected')
          this.attemptReconnect()
        })
        
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Subscribe to stock tokens for real-time data
   * @param {Array} tokens - Array of stock tokens (e.g., ['nse_cm|26009', 'nse_cm|1594'])
   * @param {String} mode - 'LTP' (Last Traded Price) or 'QUOTE' or 'SNAP_QUOTE'
   */
  subscribe(tokens, mode = 'LTP') {
    if (!this.isConnected || !this.ws) {
      console.warn('WebSocket not connected. Queuing subscriptions.')
      tokens.forEach(t => this.subscriptions.add(t))
      return
    }

    const subscriptionMap = {
      'LTP': 1,
      'QUOTE': 2,
      'SNAP_QUOTE': 3
    }

    const request = {
      correlationID: Date.now().toString(),
      messageType: 'SUBSCRIBE',
      request: {
        streaming_type: subscriptionMap[mode] || 1,
        data: {
          tokens: tokens.map(t => t.includes('|') ? t : `nse_cm|${t}`)
        }
      }
    }

    // Store subscriptions for reconnect
    tokens.forEach(t => this.subscriptions.add(t))

    // Send subscription request as binary
    const jsonRequest = JSON.stringify(request)
    this.ws.send(jsonRequest, { binary: false })
    
    console.log(`📡 Subscribed to ${tokens.length} tokens in ${mode} mode`)
  }

  /**
   * Unsubscribe from stock tokens
   */
  unsubscribe(tokens) {
    if (!this.isConnected || !this.ws) return

    tokens.forEach(t => this.subscriptions.delete(t))

    const request = {
      correlationID: Date.now().toString(),
      messageType: 'UNSUBSCRIBE',
      request: {
        streaming_type: 1,
        data: {
          tokens: tokens.map(t => t.includes('|') ? t : `nse_cm|${t}`)
        }
      }
    }

    this.ws.send(JSON.stringify(request))
    console.log(`🔇 Unsubscribed from ${tokens.length} tokens`)
  }

  /**
   * Parse binary tick data from Angel One
   */
  parseTickData(data) {
    try {
      // Angel One sends binary data with specific format
      // Let's try to parse as JSON first (some messages are JSON)
      if (typeof data === 'string' || data.toString().startsWith('{')) {
        return JSON.parse(data.toString())
      }

      // Binary format parsing (Angel One specific)
      // The binary format contains: token, ltp, ltt, volume, etc.
      // This is a simplified parser - adjust based on actual binary format
      const buffer = Buffer.from(data)
      
      if (buffer.length < 50) return null

      // Read token (first few bytes)
      let offset = 0
      const exchangeType = buffer.readInt8(offset); offset += 1
      
      // Token reading depends on exchange
      const tokenBytes = buffer.slice(offset, offset + 20).toString().trim().replace(/\0/g, '')
      offset += 20
      
      // Last Traded Price (integer * 100)
      const ltpValue = buffer.readInt32BE(offset)
      offset += 4
      const ltp = ltpValue / 100
      
      // Last Traded Time
      const ltt = buffer.readInt32BE(offset)
      offset += 4
      
      // Volume
      const volume = buffer.readInt32BE(offset)
      offset += 4
      
      // High
      const high = buffer.readInt32BE(offset) / 100
      offset += 4
      
      // Low
      const low = buffer.readInt32BE(offset) / 100
      offset += 4
      
      // Open
      const open = buffer.readInt32BE(offset) / 100
      offset += 4
      
      // Close (previous day)
      const close = buffer.readInt32BE(offset) / 100
      
      return {
        token: tokenBytes,
        exchange_type: exchangeType,
        ltp: ltp,
        ltt: ltt,
        volume: volume,
        high: high,
        low: low,
        open: open,
        close: close,
        timestamp: Date.now()
      }
      
    } catch (error) {
      // If parsing fails, return null
      return null
    }
  }

  /**
   * Keep connection alive with ping
   */
  startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.ping()
      }
    }, 30000) // Ping every 30 seconds
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  /**
   * Auto-reconnect on disconnect
   */
  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
      
      console.log(`🔄 Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
      
      setTimeout(() => {
        this.connect().catch(err => {
          console.error('Reconnect failed:', err.message)
        })
      }, delay)
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    this.stopPing()
    this.subscriptions.clear()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isConnected = false
  }
}

module.exports = AngelOneWebSocket
