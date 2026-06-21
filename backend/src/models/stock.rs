use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Stock quote data from market API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockQuote {
    pub symbol: String,
    pub current_price: f64,
    pub change: f64,
    pub change_percent: f64,
    pub high: f64,
    pub low: f64,
    pub open: f64,
    pub previous_close: f64,
    pub timestamp: DateTime<Utc>,
    pub volume: u64,
    pub avg_volume: u64,
}

/// Extended stock data for screener
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stock {
    pub symbol: String,
    pub name: String,
    pub quote: StockQuote,
    pub market_cap: Option<f64>,
    pub pe_ratio: Option<f64>,
    pub eps: Option<f64>,
    pub dividend_yield: Option<f64>,
    pub fifty_two_week_high: Option<f64>,
    pub fifty_two_week_low: Option<f64>,
    pub beta: Option<f64>,
    pub sector: Option<String>,
    pub industry: Option<String>,
}

/// Filter criteria for stock screening
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ScreenerFilter {
    pub min_price: Option<f64>,
    pub max_price: Option<f64>,
    pub min_volume: Option<u64>,
    pub max_volume: Option<u64>,
    pub min_market_cap: Option<f64>,
    pub max_market_cap: Option<f64>,
    pub min_pe: Option<f64>,
    pub max_pe: Option<f64>,
    pub min_change_percent: Option<f64>,
    pub max_change_percent: Option<f64>,
    pub sector: Option<String>,
    pub symbols: Option<Vec<String>>,
}

impl Default for ScreenerFilter {
    fn default() -> Self {
        Self {
            min_price: None,
            max_price: None,
            min_volume: None,
            max_volume: None,
            min_market_cap: None,
            max_market_cap: None,
            min_pe: None,
            max_pe: None,
            min_change_percent: None,
            max_change_percent: None,
            sector: None,
            symbols: None,
        }
    }
}

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    Subscribe { symbols: Vec<String> },
    Unsubscribe { symbols: Vec<String> },
    StockUpdate { data: StockQuote },
    ScreenerUpdate { stocks: Vec<Stock> },
    Error { message: String },
}

/// API response wrapper
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message.into()),
        }
    }
}

/// Market status
#[derive(Debug, Serialize, Deserialize)]
pub struct MarketStatus {
    pub is_open: bool,
    pub next_open: Option<DateTime<Utc>>,
    pub next_close: Option<DateTime<Utc>>,
    pub timezone: String,
}
