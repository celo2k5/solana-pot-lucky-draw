# Solana Pot Lucky Draw

Live public dashboard for Solana Pot token distributions. It connects directly to the distribution WebSocket and renders the scheduler timer, Lucky v1 mode, cycle progress, latest recipient, and real-time transfer feed.

## Run Locally

```bash
npm install
npm run dev
```

The dashboard defaults to:

```text
wss://marcelo1.up.railway.app
```

To point at another deployment, create `.env.local`:

```text
VITE_DISTRIBUTION_SOCKET_URL=wss://your-server.example
```

## Live Data

The interface hydrates from `state` and responds to `tick`, `scheduler_state`, `token_metadata`, `tx_history`, `cycle_start`, `cycle_update`, `cycle_end`, `holders_update`, and `transfer`. It caches token metadata by mint, uses token-symbol fallbacks, and shows Solscan links only for genuine transaction signatures.
