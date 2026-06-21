use crate::models::*;
use rayon::prelude::*;

/// Apply filters to a list of stocks
pub fn apply_filters(stocks: &[Stock], filter: &ScreenerFilter) -> Vec<Stock> {
    stocks
        .par_iter()
        .filter(|stock| matches_filter(stock, filter))
        .cloned()
        .collect()
}

/// Check if a single stock matches the filter criteria
fn matches_filter(stock: &Stock, filter: &ScreenerFilter) -> bool {
    // Price filter
    if let Some(min) = filter.min_price {
        if stock.quote.current_price < min {
            return false;
        }
    }
    if let Some(max) = filter.max_price {
        if stock.quote.current_price > max {
            return false;
        }
    }

    // Volume filter
    if let Some(min) = filter.min_volume {
        if stock.quote.volume < min {
            return false;
        }
    }
    if let Some(max) = filter.max_volume {
        if stock.quote.volume > max {
            return false;
        }
    }

    // Market cap filter
    if let Some(min) = filter.min_market_cap {
        if let Some(market_cap) = stock.market_cap {
            if market_cap < min {
                return false;
            }
        } else {
            return false;
        }
    }
    if let Some(max) = filter.max_market_cap {
        if let Some(market_cap) = stock.market_cap {
            if market_cap > max {
                return false;
            }
        } else {
            return false;
        }
    }

    // PE ratio filter
    if let Some(min) = filter.min_pe {
        if let Some(pe) = stock.pe_ratio {
            if pe < min {
                return false;
            }
        } else {
            return false;
        }
    }
    if let Some(max) = filter.max_pe {
        if let Some(pe) = stock.pe_ratio {
            if pe > max {
                return false;
            }
        } else {
            return false;
        }
    }

    // Change percent filter
    if let Some(min) = filter.min_change_percent {
        if stock.quote.change_percent < min {
            return false;
        }
    }
    if let Some(max) = filter.max_change_percent {
        if stock.quote.change_percent > max {
            return false;
        }
    }

    // Sector filter
    if let Some(ref sector) = filter.sector {
        if let Some(ref stock_sector) = stock.sector {
            if !stock_sector.to_lowercase().contains(&sector.to_lowercase()) {
                return false;
            }
        } else {
            return false;
        }
    }

    // Symbol filter (whitelist)
    if let Some(ref symbols) = filter.symbols {
        if !symbols.iter().any(|s| s.to_uppercase() == stock.symbol) {
            return false;
        }
    }

    true
}

/// Sort stocks by various criteria
pub fn sort_stocks(stocks: &mut [Stock], sort_by: &str, ascending: bool) {
    let cmp = |a: &f64, b: &f64| {
        if ascending {
            a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal)
        }
    };

    match sort_by.to_lowercase().as_str() {
        "price" => stocks.sort_by(|a, b| {
            cmp(&a.quote.current_price, &b.quote.current_price)
        }),
        "change" | "change_percent" => stocks.sort_by(|a, b| {
            cmp(&a.quote.change_percent, &b.quote.change_percent)
        }),
        "volume" => stocks.sort_by(|a, b| {
            cmp(&(a.quote.volume as f64), &(b.quote.volume as f64))
        }),
        "market_cap" => stocks.sort_by(|a, b| {
            cmp(&a.market_cap.unwrap_or(0.0), &b.market_cap.unwrap_or(0.0))
        }),
        "pe_ratio" | "pe" => stocks.sort_by(|a, b| {
            cmp(&a.pe_ratio.unwrap_or(f64::MAX), &b.pe_ratio.unwrap_or(f64::MAX))
        }),
        "symbol" => stocks.sort_by(|a, b| {
            if ascending {
                a.symbol.cmp(&b.symbol)
            } else {
                b.symbol.cmp(&a.symbol)
            }
        }),
        _ => {}
    }
}

/// Predefined popular stocks for quick scanning
pub const POPULAR_STOCKS: &[&str] = &[
    // Tech Giants
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AMD", "INTC",
    // Finance
    "JPM", "BAC", "WFC", "GS", "MS", "V", "MA",
    // Healthcare
    "JNJ", "PFE", "UNH", "MRK", "ABBV", "TMO",
    // Consumer
    "WMT", "KO", "PEP", "COST", "MCD", "NKE", "SBUX",
    // Industrial
    "BA", "CAT", "HON", "UPS", "GE",
    // Energy
    "XOM", "CVX", "COP", "SLB",
    // ETFs
    "SPY", "QQQ", "IWM", "VTI",
    // Others
    "NFLX", "DIS", "CRM", "ADBE", "CRM", "ORCL", "INTU", "NOW",
];

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_stock(symbol: &str, price: f64, change_percent: f64) -> Stock {
        Stock {
            symbol: symbol.to_string(),
            name: symbol.to_string(),
            quote: StockQuote {
                symbol: symbol.to_string(),
                current_price: price,
                change: price * change_percent / 100.0,
                change_percent,
                high: price * 1.05,
                low: price * 0.95,
                open: price,
                previous_close: price,
                timestamp: Utc::now(),
                volume: 1_000_000,
                avg_volume: 500_000,
            },
            market_cap: Some(1_000_000_000.0),
            pe_ratio: Some(20.0),
            eps: Some(5.0),
            dividend_yield: Some(2.0),
            fifty_two_week_high: Some(price * 1.2),
            fifty_two_week_low: Some(price * 0.8),
            beta: Some(1.0),
            sector: Some("Technology".to_string()),
            industry: Some("Software".to_string()),
        }
    }

    #[test]
    fn test_price_filter() {
        let stocks = vec![
            create_test_stock("AAPL", 150.0, 2.0),
            create_test_stock("GOOGL", 2800.0, -1.0),
        ];

        let filter = ScreenerFilter {
            min_price: Some(100.0),
            max_price: Some(200.0),
            ..Default::default()
        };

        let filtered = apply_filters(&stocks, &filter);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].symbol, "AAPL");
    }

    #[test]
    fn test_symbol_filter() {
        let stocks = vec![
            create_test_stock("AAPL", 150.0, 2.0),
            create_test_stock("GOOGL", 2800.0, -1.0),
        ];

        let filter = ScreenerFilter {
            symbols: Some(vec!["AAPL".to_string()]),
            ..Default::default()
        };

        let filtered = apply_filters(&stocks, &filter);
        assert_eq!(filtered.len(), 1);
    }
}
