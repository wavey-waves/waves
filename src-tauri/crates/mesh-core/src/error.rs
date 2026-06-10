use thiserror::Error;

#[derive(Debug, Error)]
pub enum MeshError {
    #[error("storage error: {0}")]
    Store(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("encoding error: {0}")]
    Encoding(#[from] postcard::Error),
    #[error("invalid message: {0}")]
    InvalidMessage(String),
}

pub type Result<T> = std::result::Result<T, MeshError>;
