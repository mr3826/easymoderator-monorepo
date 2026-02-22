# P1-5: Qdrant Security

## Rotate leaked API key

**Rotate the leaked Qdrant API key immediately.** The key `7fK9xP2qL8mZ4vR1tY6uB3nW5sH0cD` must be considered compromised.

1. In your Qdrant server/admin, revoke the old API key and create a new one.
2. Update `QDRANT_API_KEY` in your environment/secrets (e.g. GitHub Secrets, server .env).
3. Restart the application.

## VPC-only and API key

- **Run Qdrant on a VPC-internal host.** Set `QDRANT_URL` to a private IP (e.g. `http://10.x.x.x:6333`) so it is not reachable from the public internet.
- **Enable API key authentication on the Qdrant server.** Set `QDRANT_API_KEY` in production; the app sends it in the `api-key` header for all Qdrant requests.
- Block public access to Qdrant at the network/firewall level (security group or similar).
