import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

const API_BASE = 'http://localhost:8080'

/**
 * SearchBar — Premium glassmorphism search with autocomplete
 * - Debounced 300ms API call to /api/search/suggestions
 * - Dropdown shows symbol (bold) + company name + sector badge
 * - Click result → navigate to /stock/:symbol
 * - Escape or click outside → close dropdown
 */
export default function SearchBar() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const navigate = useNavigate()

  // Debounced fetch suggestions
  const fetchSuggestions = useCallback(async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < 1) {
      setSuggestions([])
      setIsOpen(false)
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/search/suggestions?q=${encodeURIComponent(searchQuery)}`)
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      setSuggestions(data.suggestions || data.results || [])
      setIsOpen(true)
    } catch (err) {
      console.error('Search error:', err)
      setSuggestions([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Handle input change with debounce
  const handleInputChange = (e) => {
    const value = e.target.value
    setQuery(value)
    setActiveIndex(-1)

    // Clear previous debounce timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Set new debounce timer (300ms)
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value)
    }, 300)
  }

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setActiveIndex(-1)
      inputRef.current?.blur()
      return
    }

    if (!isOpen || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      handleSelect(suggestions[activeIndex])
    }
  }

  // Handle selecting a suggestion
  const handleSelect = (suggestion) => {
    const symbol = suggestion.symbol || suggestion.ticker
    setQuery('')
    setIsOpen(false)
    setSuggestions([])
    setActiveIndex(-1)
    navigate(`/stock/${symbol}`)
  }

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div className="search-container" ref={containerRef}>
      <div className="search-input-wrapper">
        <span className="search-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search stocks... (e.g., RELIANCE, TCS, Infosys)"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true)
          }}
          autoComplete="off"
        />
        {isLoading && (
          <span className="search-spinner">
            <div className="search-spinner-ring"></div>
          </span>
        )}
        {query && !isLoading && (
          <button
            className="search-clear"
            onClick={() => {
              setQuery('')
              setSuggestions([])
              setIsOpen(false)
              inputRef.current?.focus()
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Dropdown Results */}
      {isOpen && suggestions.length > 0 && (
        <div className="search-dropdown">
          {suggestions.map((item, index) => (
            <div
              key={item.symbol || index}
              className={`search-result ${index === activeIndex ? 'active' : ''}`}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <div className="search-result-left">
                <span className="search-result-symbol">{item.symbol || item.ticker}</span>
                <span className="search-result-name">{item.name || item.companyName}</span>
              </div>
              <div className="search-result-right">
                {item.sector && (
                  <span className="search-result-sector">{item.sector}</span>
                )}
                {item.price && (
                  <span className="search-result-price">₹{Number(item.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No results state */}
      {isOpen && suggestions.length === 0 && !isLoading && query.length > 0 && (
        <div className="search-dropdown">
          <div className="search-no-results">
            <span>No stocks found for "{query}"</span>
          </div>
        </div>
      )}
    </div>
  )
}
