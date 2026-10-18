//! PostgreSQL/PostGIS persistence boundary.

#[derive(Debug, Clone)]
pub struct PostgresStore {
    database_url: String,
}

impl PostgresStore {
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }

    pub fn database_url(&self) -> &str {
        &self.database_url
    }
}
