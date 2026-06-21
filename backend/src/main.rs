use axum::{
    routing::{get, post},
    Router,
};
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod models;
mod routes;
mod services;

use routes::{
    get_popular_stocks, get_quote, get_quotes, get_stock, screen_stocks, search_stocks,
    stock_update_task, ws_handler, AppState, WsState,
};
use services::MarketDataService;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "stock_screener=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize services
    let market_data = Arc::new(MarketDataService::new());

    // Create broadcast channel for WebSocket updates
    let (broadcast_tx, _) = broadcast::channel(100);

    // Create WebSocket subscriptions map
    let subscriptions = Arc::new(DashMap::new());

    // Spawn background task for stock updates
    let market_data_clone = market_data.clone();
    let broadcast_clone = broadcast_tx.clone();
    let subscriptions_clone = subscriptions.clone();
    tokio::spawn(async move {
        stock_update_task(market_data_clone, broadcast_clone, subscriptions_clone).await;
    });

    // Build app state
    let app_state = AppState {
        market_data: market_data.clone(),
    };

    let ws_state = WsState {
        market_data,
        subscriptions,
        broadcast: broadcast_tx,
    };

    // Build API routes
    let api_routes = Router::new()
        .route("/stocks/quote/:symbol", get(get_quote))
        .route("/stocks/quotes", get(get_quotes))
        .route("/stocks/:symbol", get(get_stock))
        .route("/stocks/search", get(search_stocks))
        .route("/screener/scan", get(screen_stocks))
        .route("/screener/popular", get(get_popular_stocks))
        .with_state(app_state);

    // WebSocket routes
    let ws_routes = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(ws_state);

    // Combine all routes
    let app = Router::new()
        .nest("/api", api_routes)
        .nest("/api", ws_routes)
        // Serve frontend static files in production
        .fallback_service(ServeDir::new("frontend/dist"))
        // Enable CORS for development
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    // Start server
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("🚀 Server listening on http://{}", addr);

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await?;

    Ok(())
}
