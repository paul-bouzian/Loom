use std::sync::OnceLock;

use crate::domain::conversation::ThreadConversationSnapshot;
use crate::infrastructure::database::AppDatabase;

static SNAPSHOT_STORE: OnceLock<AppDatabase> = OnceLock::new();

pub fn install(database: AppDatabase) {
    let _ = SNAPSHOT_STORE.set(database);
}

fn db() -> Option<&'static AppDatabase> {
    SNAPSHOT_STORE.get()
}

pub fn save(snapshot: &ThreadConversationSnapshot) {
    let Some(database) = db() else {
        return;
    };
    if let Err(error) = database.save_conversation_snapshot(snapshot) {
        tracing::warn!(
            thread_id = %snapshot.thread_id,
            ?error,
            "failed to persist conversation snapshot"
        );
    }
}

pub fn load(thread_id: &str) -> Option<ThreadConversationSnapshot> {
    let database = db()?;
    match database.load_conversation_snapshot(thread_id) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            tracing::warn!(
                thread_id,
                ?error,
                "failed to load persisted conversation snapshot"
            );
            None
        }
    }
}
