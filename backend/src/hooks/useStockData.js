/**
 * Custom hook for real-time stock data
 * Connects to WebSocket for live updates
 */

import { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export function useStockData(symbol) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRealData, setIsRealData] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL);

    socket.on('connect', () => {
      console.log('Connected to stock data server');
      socket.emit('subscribe', { symbols: [symbol] });
    });

    socket.on('connected', (data) => {
      console.log('Server connected:', data);
    });

    socket.on('stockUpdate', (stockData) => {
      if (stockData.symbol === symbol) {
        setData(stockData);
        setIsRealData(stockData.isRealData);
        setLoading(false);
      }
    });

    socket.on('stockData', (stockData) => {
      if (stockData.symbol === symbol) {
        setData(stockData);
        setIsRealData(stockData.isRealData);
        setLoading(false);
      }
    });

    socket.on('error', (err) => {
      setError(err.message);
      setLoading(false);
    });

    // Request initial data
    socket.emit('getStockData', { symbol });

    return () => {
      socket.emit('unsubscribe', { symbols: [symbol] });
      socket.disconnect();
    };
  }, [symbol]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
  }, []);

  return { data, loading, error, isRealData, refresh };
}

/**
 * Hook for multiple stocks
 */
export function useStocksData(symbols) {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const socket = io(SOCKET_URL);

    socket.on('connect', () => {
      socket.emit('subscribe', { symbols });
    });

    socket.on('stocksUpdate', (stocksData) => {
      setStocks(stocksData);
      setLoading(false);
    });

    socket.on('stockUpdate', (stockData) => {
      setStocks(prev => {
        const index = prev.findIndex(s => s.symbol === stockData.symbol);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = stockData;
          return updated;
        }
        return prev;
      });
    });

    socket.on('error', (err) => {
      setError(err.message);
      setLoading(false);
    });

    return () => {
      socket.emit('unsubscribe', { symbols });
      socket.disconnect();
    };
  }, [symbols.join(',')]);

  return { stocks, loading, error };
}

/**
 * Hook for market status
 */
export function useMarketStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const socket = io(SOCKET_URL);

    socket.on('marketStatus', (marketStatus) => {
      setStatus(marketStatus);
      setLoading(false);
    });

    return () => socket.disconnect();
  }, []);

  return { status, loading };
}

/**
 * Hook for real-time price history
 */
export function usePriceHistory(symbol, maxPoints = 100) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const socket = io(SOCKET_URL);

    socket.on('connect', () => {
      socket.emit('subscribe', { symbols: [symbol] });
    });

    socket.on('stockUpdate', (stockData) => {
      if (stockData.symbol === symbol) {
        setHistory(prev => {
          const newPoint = {
            time: Date.now(),
            price: stockData.price,
            volume: stockData.volume
          };
          const updated = [...prev, newPoint];
          return updated.slice(-maxPoints);
        });
      }
    });

    return () => socket.disconnect();
  }, [symbol, maxPoints]);

  return history;
}

export default useStockData;
