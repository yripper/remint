import { Buffer } from 'buffer'

// Stellar SDK and some wallet modules expect Node's Buffer as a global in the browser.
// Imported first in main.tsx so it runs before those modules evaluate.
const globals = globalThis as unknown as { Buffer?: typeof Buffer }
globals.Buffer ??= Buffer
