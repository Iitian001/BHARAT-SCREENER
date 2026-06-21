use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::models::{ApiResponse, ScreenerFilter, Stock, StockQuote};
use crate::services::{apply_filters, sort_stocks, MarketDataService, POPULAR_STOCKS};

/// Application state
#[derive(Clone)]
pub struct AppState {
    pub market_data: Arc<MarketDataService>,
}

#[derive(Debug, Deserialize)]
pub struct GetQuotesQuery {
    /// Comma-separated list of symbols
    pub symbols: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
}

#[derive(Debug, Deserialize)]
pub struct ScreenerQuery {
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
    pub symbols: Option<String>,
    pub sort_by: Option<String>,
    #[serde(default)]
    pub ascending: Option<bool>,
}

/// GET /api/stocks/quote/:symbol - Get quote for a single stock
pub async fn get_quote(
    Path(symbol): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<StockQuote>>, (StatusCode, Json<ApiResponse<()>>)> {
    let quote = state
        .market_data
        .get_quote(&symbol)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::error(&e.to_string())),
            )
        })?;

    Ok(Json(ApiResponse::success(quote)))
}

/// GET /api/stocks/quotes?symbols=AAPL,GOOGL,MSFT - Get quotes for multiple stocks
pub async fn get_quotes(
    Query(query): Query<GetQuotesQuery>,
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<StockQuote>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let symbols: Vec<String> = query
        .symbols
        .split(',')
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty())
        .collect();

    if symbols.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::error("No symbols provided")),
        ));
    }

    let quotes = state
        .market_data
        .get_quotes(&symbols)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::error(&e.to_string())),
            )
        })?;

    Ok(Json(ApiResponse::success(quotes)))
}

/// GET /api/stocks/:symbol - Get full stock data including financials
pub async fn get_stock(
    Path(symbol): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Stock>>, (StatusCode, Json<ApiResponse<()>>)> {
    let stock = state
        .market_data
        .get_stock_data(&symbol)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::error(&e.to_string())),
            )
        })?;

    Ok(Json(ApiResponse::success(stock)))
}

/// GET /api/stocks/search?q=apple - Search for stocks
pub async fn search_stocks(
    Query(query): Query<SearchQuery>,
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<SearchResult>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let results = state
        .market_data
        .search_stocks(&query.q)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::error(&e.to_string())),
            )
        })?;

    Ok(Json(ApiResponse::success(results)))
}

/// GET /api/screener/scan - Screen stocks based on criteria
pub async fn screen_stocks(
    Query(query): Query<ScreenerQuery>,
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<Stock>>>, (StatusCode, Json<ApiResponse<()>>)> {
    // Determine which symbols to scan
    let symbols: Vec<String> = if let Some(ref symbols_str) = query.symbols {
        symbols_str
            .split(',')
            .map(|s| s.trim().to_uppercase())
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        POPULAR_STOCKS.iter().map(|s| s.to_string()).collect()
    };

    // Fetch stock data for all symbols
    let mut stocks: Vec<Stock> = state
        .market_data
        .get_stock_data_batch(&symbols)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::<()>::error(&e.to_string())),
            )
        })?;

    // Build filter from query params
    let filter = ScreenerFilter {
        min_price: query.min_price,
        max_price: query.max_price,
        min_volume: query.min_volume,
        max_volume: query.max_volume,
        min_market_cap: query.min_market_cap,
        max_market_cap: query.max_market_cap,
        min_pe: query.min_pe,
        max_pe: query.max_pe,
        min_change_percent: query.min_change_percent,
        max_change_percent: query.max_change_percent,
        sector: query.sector,
        symbols: None, // Already filtered by the symbols param
    };

    // Apply filters
    let mut results = apply_filters(&stocks, &filter);

    // Sort results
    if let Some(ref sort_by) = query.sort_by {
        sort_stocks(&mut results, sort_by, query.ascending.unwrap_or(false));
    }

    Ok(Json(ApiResponse::success(results)))
}

/// GET /api/screener/popular - Get list of popular stock symbols
pub async fn get_popular_stocks() -> Json<ApiResponse<Vec<&'static str>>> {
    Json(ApiResponse::success(POPULAR_STOCKS.to_vec()))
}

// Re-export SearchResult from market_data service
pub use crate::services::SearchResult;
