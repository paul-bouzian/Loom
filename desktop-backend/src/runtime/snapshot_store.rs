use std::sync::{
    mpsc::{self, Sender},
    OnceLock,
};
use std::thread;

use crate::domain::conversation::ThreadConversationSnapshot;
use crate::infrastructure::database::AppDatabase;

static SNAPSHOT_STORE: OnceLock<SnapshotStore> = OnceLock::new();

struct SnapshotStore {
    database: AppDatabase,
    sender: Sender<ThreadConversationSnapshot>,
}

pub fn install(database: AppDatabase) {
    if SNAPSHOT_STORE.get().is_some() {
        return;
    }

    let (sender, receiver) = mpsc::channel::<ThreadConversationSnapshot>();
    let worker_database = database.clone();
    if let Err(error) = thread::Builder::new()
        .name("skein-snapshot-store".to_string())
        .spawn(move || {
            for snapshot in receiver {
                if let Err(error) = worker_database.save_conversation_snapshot(&snapshot) {
                    tracing::warn!(
                        thread_id = %snapshot.thread_id,
                        ?error,
                        "failed to persist conversation snapshot"
                    );
                }
            }
        })
    {
        tracing::warn!(
            ?error,
            "failed to start conversation snapshot persistence worker"
        );
        return;
    }

    let _ = SNAPSHOT_STORE.set(SnapshotStore { database, sender });
}

fn store() -> Option<&'static SnapshotStore> {
    SNAPSHOT_STORE.get()
}

pub fn save(snapshot: &ThreadConversationSnapshot) {
    let Some(store) = store() else {
        return;
    };
    if let Err(error) = store.sender.send(snapshot.clone()) {
        tracing::warn!(
            thread_id = %snapshot.thread_id,
            ?error,
            "failed to enqueue conversation snapshot persistence"
        );
    }
}

pub fn load(thread_id: &str) -> Option<ThreadConversationSnapshot> {
    let store = store()?;
    match store.database.load_conversation_snapshot(thread_id) {
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
