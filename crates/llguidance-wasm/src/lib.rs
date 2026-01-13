//! WebAssembly bindings for llguidance
//!
//! This crate provides JavaScript-accessible bindings to the llguidance
//! constrained generation library, enabling grammar-based token validation
//! for use with transformer.js.

use js_sys::Uint8Array;
use serde::Deserialize;
use std::sync::Arc;
use wasm_bindgen::prelude::*;

use llguidance::api::TopLevelGrammar;
use llguidance::toktrie::ApproximateTokEnv;
use llguidance::{Matcher, ParserFactory};

/// Grammar definition passed from JavaScript
#[derive(Debug, Deserialize)]
struct GrammarInput {
    grammars: Vec<GrammarSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum GrammarSpec {
    JsonSchema { json_schema: serde_json::Value },
    Regex { rx: String },
    Lark { lark: String },
}

/// The main parser struct exposed to JavaScript
#[wasm_bindgen]
pub struct LLGuidanceParser {
    factory: Arc<ParserFactory>,
    matcher: Matcher,
    vocab_size: usize,
}

#[wasm_bindgen]
impl LLGuidanceParser {
    /// Create a new parser with the given grammar and tokenizer configuration
    #[wasm_bindgen(constructor)]
    pub fn new(grammar_json: &str, tokenizer_json: &str) -> Result<LLGuidanceParser, JsValue> {
        // Set up panic hook for better error messages
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        Self::new_inner(grammar_json, tokenizer_json)
            .map_err(|e| JsValue::from_str(&e))
    }

    fn new_inner(grammar_json: &str, _tokenizer_json: &str) -> Result<LLGuidanceParser, String> {
        // Parse the grammar
        let grammar = Self::parse_grammar(grammar_json)?;

        // Create a simple tokenizer environment
        let tok_env = ApproximateTokEnv::single_byte_env();
        let vocab_size = tok_env.tok_trie().vocab_size() as usize;

        // Create parser factory
        let mut factory = ParserFactory::new_simple(&tok_env)
            .map_err(|e| format!("Failed to create parser factory: {}", e))?;

        // Minimal logging
        factory.set_stderr_log_level(0);

        let factory = Arc::new(factory);

        // Create the parser and matcher
        let parser = factory.create_parser(grammar);
        let matcher = Matcher::new(parser);

        Ok(LLGuidanceParser {
            factory,
            matcher,
            vocab_size,
        })
    }

    fn parse_grammar(grammar_json: &str) -> Result<TopLevelGrammar, String> {
        // Try to parse as our simplified GrammarInput format first (most common case)
        if let Ok(input) = serde_json::from_str::<GrammarInput>(grammar_json) {
            if !input.grammars.is_empty() {
                return Self::convert_grammar(&input);
            }
        }

        // Fall back to parsing directly as TopLevelGrammar (native .ll.json format)
        serde_json::from_str::<TopLevelGrammar>(grammar_json)
            .map_err(|e| format!("Failed to parse grammar JSON: {}", e))
    }

    fn convert_grammar(input: &GrammarInput) -> Result<TopLevelGrammar, String> {
        if input.grammars.is_empty() {
            return Err("No grammars provided".to_string());
        }

        // For now, handle the first grammar only
        let spec = &input.grammars[0];

        match spec {
            GrammarSpec::JsonSchema { json_schema } => {
                // Use TopLevelGrammar::from_json_schema
                Ok(TopLevelGrammar::from_json_schema(json_schema.clone()))
            }
            GrammarSpec::Regex { rx } => {
                // Create a lark grammar that matches the regex
                let lark_grammar = format!("start: /{}/", rx);
                Ok(TopLevelGrammar::from_lark(lark_grammar))
            }
            GrammarSpec::Lark { lark } => {
                Ok(TopLevelGrammar::from_lark(lark.clone()))
            }
        }
    }

    /// Check if a specific token is allowed at the current position
    #[wasm_bindgen]
    pub fn is_token_allowed(&mut self, token_id: u32) -> Result<bool, JsValue> {
        let mask = self
            .matcher
            .compute_mask()
            .map_err(|e| JsValue::from_str(&format!("Failed to compute mask: {}", e)))?;

        Ok(mask.is_allowed(token_id))
    }

    /// Get the full token mask for the current position
    #[wasm_bindgen]
    pub fn get_token_mask(&mut self) -> Result<Uint8Array, JsValue> {
        let mask = self
            .matcher
            .compute_mask()
            .map_err(|e| JsValue::from_str(&format!("Failed to compute mask: {}", e)))?;

        let mut mask_vec = vec![0u8; self.vocab_size];
        for i in 0..self.vocab_size {
            if mask.is_allowed(i as u32) {
                mask_vec[i] = 1;
            }
        }

        let js_array = Uint8Array::new_with_length(mask_vec.len() as u32);
        js_array.copy_from(&mask_vec);
        Ok(js_array)
    }

    /// Advance the parser state after a token has been selected
    #[wasm_bindgen]
    pub fn advance(&mut self, token_id: u32) -> Result<(), JsValue> {
        self.matcher
            .consume_token(token_id)
            .map_err(|e| JsValue::from_str(&format!("Failed to consume token: {}", e)))?;
        Ok(())
    }

    /// Check if the current state represents a valid complete parse
    #[wasm_bindgen]
    pub fn is_complete(&self) -> bool {
        let reason = format!("{:?}", self.matcher.stop_reason());
        reason.contains("EndOfSentence")
            || reason.contains("NoExtension")
            || reason.contains("MaxTokensTotal")
            || reason.contains("NoExtensionBias")
    }

    /// Reset the parser to its initial state
    #[wasm_bindgen]
    pub fn reset(&mut self, grammar_json: &str) -> Result<(), JsValue> {
        let grammar = Self::parse_grammar(grammar_json)
            .map_err(|e| JsValue::from_str(&e))?;
        let parser = self.factory.create_parser(grammar);
        self.matcher = Matcher::new(parser);
        Ok(())
    }

    /// Get the vocabulary size
    #[wasm_bindgen]
    pub fn vocab_size(&self) -> usize {
        self.vocab_size
    }

    /// Get the current stop reason
    #[wasm_bindgen]
    pub fn stop_reason(&self) -> String {
        format!("{:?}", self.matcher.stop_reason())
    }
}

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}
