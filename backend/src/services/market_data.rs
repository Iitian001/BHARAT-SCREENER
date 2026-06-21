use anyhow::{Context, Result};
use reqwest::Client;
use std::env;
use crate::models::*;

const FINNHUB_BASE_URL: &str = "https://finnhub.io/api/v1";

pub struct MarketDataService {
    client: Client,
    api_key: String,
}

impl MarketDataService {
    pub fn new() -> Self {
        let api_key = env::var("FINNHUB_API_KEY")
            .unwrap_or_else(|_| "demo".to_string());
        
        Self {
            client: Client::new(),
            api_key,
        }
    }

    /// Fetch real-time quote for a single symbol
    pub async fn get_quote(&self, symbol: &str) -> Result<StockQuote> {
        let url = format!(
            "{}/quote?symbol={}&token={}",
            FINNHUB_BASE_URL,
            symbol,
            self.api_key
        );

        let response = self.client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch quote from Finnhub")?;

        if !response.status().is_success() {
            anyhow::bail!("Finnhub API error: {}", response.status());
        }

        let data: FinnhubQuote = response
            .json()
            .await
            .context("Failed to parse Finnhub response")?;

        Ok(StockQuote::from_finnhub(symbol.to_uppercase(), data))
    }

    /// Fetch quotes for multiple symbols concurrently
    pub async fn get_quotes(&self, symbols: &[String]) -> Result<Vec<StockQuote>> {
        let futures: Vec<_> = symbols
            .iter()
            .map(|s| self.get_quote(s))
            .collect();

        let results = futures::future::join_all(futures).await;
        
        let quotes: Vec<StockQuote> = results
            .into_iter()
            .filter_map(|r| r.ok())
            .collect();

        Ok(quotes)
    }

    /// Get company profile (for sector, industry, etc.)
    pub async fn get_company_profile(&self, symbol: &str) -> Result<Option<CompanyProfile>> {
        let url = format!(
            "{}/stock/profile2?symbol={}&token={}",
            FINNHUB_BASE_URL,
            symbol,
            self.api_key
        );

        let response = self.client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch company profile")?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let profile: CompanyProfile = response
            .json()
            .await
            .context("Failed to parse company profile")?;

        Ok(Some(profile))
    }

    /// Get basic financials (PE ratio, market cap, etc.)
    pub async fn get_basic_financials(&self, symbol: &str) -> Result<Option<BasicFinancials>> {
        let url = format!(
            "{}/stock/metric?symbol={}&metric=all&token={}",
            FINNHUB_BASE_URL,
            symbol,
            self.api_key
        );

        let response = self.client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch financials")?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let data: FinnhubMetrics = response
            .json()
            .await
            .context("Failed to parse financials")?;

        Ok(Some(data.metric))
    }

    /// Get full stock data including financials
    pub async fn get_stock_data(&self, symbol: &str) -> Result<Stock> {
        let (quote, profile, financials) = tokio::try_join!(
            self.get_quote(symbol),
            async { self.get_company_profile(symbol).await },
            async { self.get_basic_financials(symbol).await }
        )?;

        let quote = quote;
        let profile = profile.unwrap_or_default();
        let financials = financials.unwrap_or_default();

        Ok(Stock {
            symbol: symbol.to_uppercase(),
            name: profile.name.unwrap_or_else(|| symbol.to_uppercase()),
            quote,
            market_cap: financials.market_capitalization,
            pe_ratio: financials.pe_basic_eps_ttm,
            eps: financials.eps_basic_ttm,
            dividend_yield: financials.dividend_yield_ttm,
            fifty_two_week_high: financials._52_week_high,
            fifty_two_week_low: financials._52_week_low,
            beta: financials.beta,
            sector: profile.finnhub_industry,
            industry: profile.industry,
        })
    }

    /// Search for stocks by query
    pub async fn search_stocks(&self, query: &str) -> Result<Vec<SearchResult>> {
        let url = format!(
            "{}/search?q={}&token={}",
            FINNHUB_BASE_URL,
            query,
            self.api_key
        );

        let response = self.client
            .get(&url)
            .send()
            .await
            .context("Failed to search stocks")?;

        let data: SearchResponse = response
            .json()
            .await
            .context("Failed to parse search results")?;

        Ok(data.result)
    }

    /// Fetch stock data for multiple symbols (with rate limiting)
    pub async fn get_stock_data_batch(&self, symbols: &[String]) -> Result<Vec<Stock>> {
        let mut stocks = Vec::with_capacity(symbols.len());
        
        // Process in batches of 10 to avoid rate limits
        for chunk in symbols.chunks(10) {
            let futures: Vec<_> = chunk
                .iter()
                .map(|s| self.get_stock_data(s))
                .collect();
            
            let results = futures::future::join_all(futures).await;
            
            for result in results {
                if let Ok(stock) = result {
                    stocks.push(stock);
                }
            }
            
            // Small delay between batches to avoid rate limiting
            if symbols.len() > 10 {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        }
        
        Ok(stocks)
    }
}

// --- Finnhub API Response Types ---

#[derive(Debug, Deserialize)]
struct FinnhubQuote {
    c: f64,    // Current price
    d: f64,    // Change
    dp: f64,   // Change percent
    h: f64,    // High
    l: f64,    // Low
    o: f64,    // Open
    pc: f64,   // Previous close
    t: i64,    // Timestamp
    #[serde(default)]
    v: u64,    // Volume
}

impl FinnhubQuote {
    fn into_stock_quote(self, symbol: String) -> StockQuote {
        StockQuote {
            symbol,
            current_price: self.c,
            change: self.d,
            change_percent: self.dp,
            high: self.h,
            low: self.l,
            open: self.o,
            previous_close: self.pc,
            timestamp: chrono::DateTime::from_timestamp(self.t, 0)
                .unwrap_or_else(chrono::Utc::now),
            volume: self.v,
            avg_volume: 0,
        }
    }
}

impl StockQuote {
    fn from_finnhub(symbol: String, data: FinnhubQuote) -> Self {
        data.into_stock_quote(symbol)
    }
}

#[derive(Debug, Deserialize, Default)]
struct CompanyProfile {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    finnhub_industry: Option<String>,
    #[serde(default)]
    industry: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct FinnhubMetrics {
    #[serde(default)]
    metric: BasicFinancials,
}

#[derive(Debug, Deserialize, Default)]
pub struct BasicFinancials {
    #[serde(rename = "marketCapitalization", default)]
    pub market_capitalization: Option<f64>,
    #[serde(rename = "peBasicEPSExclExtraItemsTTM", default)]
    pub pe_basic_eps_ttm: Option<f64>,
    #[serde(rename = "epsBasicExclExtraItemsTTM", default)]
    pub eps_basic_ttm: Option<f64>,
    #[serde(rename = "dividendYieldTTM", default)]
    pub dividend_yield_ttm: Option<f64>,
    #[serde(rename = "52WeekHigh", default)]
    pub _52_week_high: Option<f64>,
    #[serde(rename = "52WeekLow", default)]
    pub _52_week_low: Option<f64>,
    #[serde(default)]
    pub beta: Option<f64>,
    #[serde(rename = "3MonthAverageTradingVolume", default)]
    pub avg_volume: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    result: Vec<SearchResult>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchResult {
    pub symbol: String,
    pub description: String,
    #[serde(rename = "type")]
    pub security_type: String,
}
