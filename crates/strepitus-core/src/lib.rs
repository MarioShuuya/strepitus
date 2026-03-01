pub mod audio;
pub mod engine;
pub mod physics;
pub mod types;

use wasm_bindgen::prelude::*;

/// Called when the WASM module loads. Sets up panic hook for better error messages.
#[wasm_bindgen(start)]
pub fn init() {
    web_sys::console::log_1(&"[strepitus-core] WASM module initialized".into());
}

/// Version string for the physics engine.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
