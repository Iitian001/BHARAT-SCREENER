use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
};
use chrono::Utc;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::broadcast;

use crate::models::WsMessage;
use crate::services::MarketDataService;

/// Active WebSocket connections and their subscriptions
pub type Subscriptions = Arc<DashMap<usize, Vec<String>>>;

/// Broadcast channel for stock updates
pub type StockBroadcast = broadcast::Sender<WsMessage>;

/// Application state for WebSocket
#[derive(Clone)]
pub struct WsState {
    pub market_data: Arc<MarketDataService>,
    pub subscriptions: Subscriptions,
    pub broadcast: StockBroadcast,
}

#[derive(Debug, Deserialize)]
pub struct WsQueryParams {
    #[serde(default)]
    pub symbols: Option<String>,
}

/// WebSocket upgrade handler
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsQueryParams>,
    State(ws_state): State<WsState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_websocket(socket, ws_state, params))
}

/// Handle WebSocket connection
async fn handle_websocket(socket: WebSocket, state: WsState, params: WsQueryParams) {
    let (mut tx, mut rx) = socket.split();
    let connection_id = rand::random::<usize>();

    // Initialize with query params if provided
    if let Some(ref symbols_str) = params.symbols {
        let symbols: Vec<String> = symbols_str
            .split(',')
            .map(|s| s.trim().to_uppercase())
            .filter(|s| !s.is_empty())
            .collect();
        
        if !symbols.is_empty() {
            state.subscriptions.insert(connection_id, symbols);
            tracing::info!("Client {} subscribed to: {:?}", connection_id, symbols);
        }
    }

    // Subscribe to broadcast channel
    let mut broadcast_rx = state.broadcast.subscribe();

    // Spawn a task to send updates to the client
    let subscriptions = state.subscriptions.clone();
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = broadcast_rx.recv().await {
            // Check if this client is subscribed to the updated symbol
            let should_send = subscriptions
                .view(&connection_id, |_, subs| {
                    match &msg {
                        WsMessage::StockUpdate { data } => {
                            subs.contains(&data.symbol)
                        }
                        WsMessage::Heartbeat { .. } => true,
                        _ => false,
                    }
                });

            if should_send.unwrap_or(false) {
                let json = serde_json::to_string(&msg).unwrap_or_default();
                if tx.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
        }
    });

    // Handle incoming messages from client
    while let Some(msg) = rx.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                    handle_client_message(state.clone(), connection_id, ws_msg);
                }
            }
            Ok(Message::Close(_)) => {
                state.subscriptions.remove(&connection_id);
                tracing::info!("Client {} disconnected", connection_id);
                break;
            }
            Err(e) => {
                tracing::warn!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    // Cleanup
    state.subscriptions.remove(&connection_id);
    send_task.abort();
}

/// Handle message from client
fn handle_client_message(
    state: WsState,
    connection_id: usize,
    msg: WsMessage,
) {
    match msg {
        WsMessage::Subscribe { symbols } => {
            state
                .subscriptions
                .entry(connection_id)
                .or_insert_with(Vec::new)
                .extend(symbols);
            tracing::debug!("Client {} updated subscriptions", connection_id);
        }
        WsMessage::Unsubscribe { symbols } => {
            if let Some(entry) = state.subscriptions.get_mut(&connection_id) {
                entry.retain(|s| !symbols.contains(s));
            }
        }
        WsMessage::Heartbeat { .. } => {
            // Heartbeat is handled automatically
        }
        _ => {
            tracing::warn!("Unexpected message type from client");
        }
    }
}

/// Background task to fetch stock updates and broadcast them
pub async fn stock_update_task(
    market_data: Arc<MarketDataService>,
    broadcast: StockBroadcast,
    subscriptions: Subscriptions,
) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));

    loop {
        interval.tick().await;

        // Collect all subscribed symbols
        let all_symbols: Vec<String> = subscriptions
            .iter()
            .flat_map(|entry| entry.value().clone())
            .collect();

        if all_symbols.is_empty() {
            continue;
        }

        tracing::debug!("Fetching updates for {} symbols", all_symbols.len());

        // Fetch quotes
        match market_data.get_quotes(&all_symbols).await {
            Ok(quotes) => {
                for quote in quotes {
                    let msg = WsMessage::StockUpdate { data: quote };
                    if broadcast.send(msg).is_err() {
                        tracing::warn!("No active subscribers for stock update");
                    }
                }
            }
            Err(e) => {
                tracing::error!("Failed to fetch quotes: {}", e);
            }
        }

        // Send heartbeat periodically
        let now = Utc::now();
        let heartbeat = WsMessage::Heartbeat { timestamp: now };
        let _ = broadcast.send(heartbeat);
    }
}
