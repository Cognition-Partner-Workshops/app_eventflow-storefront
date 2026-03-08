# EventFlow Storefront

Customer-facing e-commerce UI for the EventFlow demo stack. Workshop participants use this to place orders and experience the zero-decimal currency bug firsthand.

## User Experience

1. **Select products** — pick from pre-loaded electronics catalog
2. **Choose currency** — USD (works) or JPY (triggers the bug)
3. **Place order** — USD orders succeed immediately; JPY orders show a long loading spinner followed by an unhelpful "Unable to Process Order" error
4. **View order history** — see all orders and their statuses

## Architecture

- Static HTML/CSS/JS served via nginx
- Talks to the Order Service REST API (`/api/orders`)
- Each team deployment gets its own backend URL injected at container startup via `API_BASE` env var
- No build step required — vanilla JS, no frameworks

## Deployment

Each team gets their own Container App:
- `ef-store-team1` → points to `ef-order-team1`
- `ef-store-team2` → points to `ef-order-team2`
- ...through `ef-store-team10`

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `API_BASE` | Order Service URL (no trailing slash) | `https://ef-order-team1.salmonbush-13ada168.eastus.azurecontainerapps.io` |

### Local Development

```bash
docker build -t eventflow-storefront .
docker run -p 8080:8080 -e API_BASE=http://localhost:8001 eventflow-storefront
```

Then open http://localhost:8080
