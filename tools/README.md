# ROD tools

This folder contains the optional local helper used when the static browser wallet needs browser-safe access to a local ROD Core JSON-RPC node. Nothing here is required to open [`index.html`](../index.html) or to use ordinary browser-only wallet functions.

## Folder contents

- [`rod-rpc-cors-proxy.js`](rod-rpc-cors-proxy.js) — Node-based CORS proxy source
- [`rod-rpc-cors-proxy.exe`](rod-rpc-cors-proxy.exe) — prebuilt Windows executable for the same helper
- [`rpcproxy.bat`](rpcproxy.bat) — convenience launcher for Windows users
- [`package.json`](package.json) and [`package-lock.json`](package-lock.json) — helper-only build metadata and pinned dependency graph

## Purpose

The proxy forwards browser requests from a local HTTP endpoint to local ROD Core JSON-RPC so OTC features that rely on wallet-scoped RPC or name operations can work without embedding RPC access into the static page itself.

```text
browser  →  http://127.0.0.1:18080/...  →  ROD Core http://127.0.0.1:11999/...
```

## Run

Use either checked-in launcher from the repository root:

```bat
tools\rod-rpc-cors-proxy.exe
```

or, if you want the script version:

```bat
cd tools && node rod-rpc-cors-proxy.js
```

Options:

```bat
rod-rpc-cors-proxy.exe --listen 18080 --bind 127.0.0.1 --target http://127.0.0.1:11999
```

## Wallet settings

In OTC → Settings → ROD Core RPC, point the wallet at the proxy port rather than Core’s native RPC port:

```text
http://xuser1:xpass1@127.0.0.1:18080/wallet/ROD
```

This keeps the browser talking to the helper while the helper talks to ROD Core.

## Rebuild the executable

Run from [`tools/`](./):

```bat
npm ci
npm run build:exe
```

[`package.json`](package.json) defines `npm start` for the script form and `npm run build:exe` for the Windows binary. This helper has its own Node packaging, but the main wallet remains a no-build static application.
