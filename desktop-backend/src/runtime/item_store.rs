use std::sync::OnceLock;

use crate::domain::conversation::ConversationItem;
use crate::infrastructure::database::AppDatabase;

static ITEM_STORE: OnceLock<AppDatabase> = OnceLock::new();

pub fn install(database: AppDatabase) {
    let _ = ITEM_STORE.set(database);
}

fn db() -> Option<&'static AppDatabase> {
    ITEM_STORE.get()
}

/// Only persist items that the upstream provider (Codex `thread/read`,
/// Claude resume) does NOT return on its own. Messages and reasoning are
/// returned reliably; saving them locally would double-render on reload.
fn should_persist(item: &ConversationItem) -> bool {
    matches!(
        item,
        ConversationItem::Tool(_) | ConversationItem::System(_)
    )
}

pub fn save(thread_id: &str, item: &ConversationItem) {
    if !should_persist(item) {
        return;
    }
    let Some(database) = db() else {
        return;
    };
    if let Err(error) = database.save_conversation_item(thread_id, item) {
        tracing::warn!(thread_id, ?error, "failed to persist conversation item");
    }
}

pub fn load(thread_id: &str) -> Vec<ConversationItem> {
    let Some(database) = db() else {
        return Vec::new();
    };
    match database.load_conversation_items(thread_id) {
        Ok(items) => items,
        Err(error) => {
            tracing::warn!(thread_id, ?error, "failed to load persisted conversation items");
            Vec::new()
        }
    }
}

#[allow(dead_code)]
pub fn remove(thread_id: &str) {
    let Some(database) = db() else {
        return;
    };
    if let Err(error) = database.delete_conversation_items(thread_id) {
        tracing::warn!(thread_id, ?error, "failed to delete persisted conversation items");
    }
}
