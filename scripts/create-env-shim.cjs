#!/usr/bin/env node
/**
 * Post-build script to create env shim for WASM instant crate
 */

const fs = require('fs');
const path = require('path');

const pkgDir = path.join(__dirname, '../pkg');
const envPath = path.join(pkgDir, 'env.js');

const envShim = `// Environment shim for WASM instant crate
// Provides timing functions needed by the instant crate

let perfNow;

// Check for browser performance API
if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
  perfNow = () => performance.now();
} else {
  // Node.js fallback
  try {
    const { performance: nodePerf } = require('perf_hooks');
    perfNow = () => nodePerf.now();
  } catch {
    // Last resort fallback
    perfNow = () => Date.now();
  }
}

export function now() {
  return perfNow();
}
`;

fs.writeFileSync(envPath, envShim);
console.log('Created pkg/env.js shim');
