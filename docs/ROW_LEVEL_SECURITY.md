# P2-1: Row-Level Security (Multi-Tenant)

## Application-level enforcement

All multi-tenant queries **must** enforce `shop_id`:

- Use **Sequelize scopes** where available: `Order.scope('shopScoped', shopId).findAll()`, or always include `where: { shop_id: shopId }` in queries.
- Models with `shopScoped(shopId)` scope: Order, Product, Customer. Use this scope or an explicit `shop_id` condition for all reads/writes that are tenant-scoped.
- Never rely on client-supplied `shop_id` from body/headers; use `req.user.shopId` (JWT) after auth.

## Database-level (PostgreSQL RLS) — optional

For defense in depth, you can enable PostgreSQL Row-Level Security on tenant tables:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_shop_isolation ON orders
  USING (shop_id = current_setting('app.current_shop_id')::uuid);

-- Repeat for products, customers, and other shop-scoped tables.
-- Set app.current_shop_id at the start of each request (e.g. in middleware) via:
-- SET LOCAL app.current_shop_id = '<shop_id>';
```

Then in your app, run `SET LOCAL app.current_shop_id = $shopId` in the same transaction/connection before querying. This ensures the DB enforces tenant isolation even if application code omits `shop_id`.
