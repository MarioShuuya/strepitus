# Strepitus — Claude Code Guidelines

## Environment

Always prepend to PATH before running Rust or bun commands:

```bash
export PATH="/c/Users/mrmar/.cargo/bin:/c/Users/mrmar/.bun/bin:$PATH"
```

## Conventions

- **Package manager:** bun (never npm/yarn)
- **Charts & diagrams:** Always use Mermaid when possible, prefer horizontal (LR) layout. This applies to README files, research docs, and any other markdown files. Note: Mermaid does not support `\n` inside node labels — use a space or split into multiple nodes instead.
- **Tests:** `cargo test` from `crates/strepitus-core/`
- **WASM build:** `wasm-pack build --target web --out-dir ../../web/src/wasm` from `crates/strepitus-core/`
- **Frontend build:** `bun run build` from `web/`
- **Dev server:** `bun run dev` from `web/`

## CSS Rules

- **Never use px for layout sizing** — use `rem`, `em`, `%`, or `flex` instead
- Base font size is set via `:root { font-size: 13px; }` — all other sizes must use `rem`
- Only exception: `1px` borders are acceptable
- Prefer `flex` properties and `%` for layout widths/heights

## Playwright Testing

- **Always pause before screenshotting:** When using the Playwright MCP to test the app, always wait (e.g. `browser_wait_for` with a short delay) before taking a screenshot. This ensures animations and async rendering have settled.

## Build & Deploy Checklist

1. `cargo test` from `crates/strepitus-core/` — all tests pass
2. `wasm-pack build --target web --out-dir ../../web/src/wasm` from `crates/strepitus-core/`
3. `bun run build` from `web/` — TypeScript + Vite build succeeds
