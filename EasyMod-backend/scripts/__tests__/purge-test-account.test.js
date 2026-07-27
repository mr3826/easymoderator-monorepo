const {
  topologicalOrder,
  expandableForeignKeys,
  ROOT_ONLY,
  RETAIN,
} = require('../purge-test-account');

const fk = (child, column, parent) => ({
  child_table: child,
  child_column: column,
  child_not_null: true,
  parent_table: parent,
  parent_column: 'id',
});

describe('purge-test-account scope safety', () => {
  it('never expands into users, shops or tenants', () => {
    // shops.tenant_id is the dangerous edge: followed backwards from a shared
    // tenant it would sweep in another merchant's shops, then their users.
    const edges = expandableForeignKeys([
      fk('shops', 'tenant_id', 'tenants'),
      fk('users', 'tenant_id', 'tenants'),
      fk('user_shops', 'shop_id', 'shops'),
      fk('products', 'shop_id', 'shops'),
    ]);

    expect(edges.map((e) => e.child_table)).toEqual(['user_shops', 'products']);
    for (const table of ROOT_ONLY) {
      expect(edges.some((e) => e.child_table === table)).toBe(false);
    }
  });

  it('never expands into retained audit tables', () => {
    const edges = expandableForeignKeys([...RETAIN].map((t) => fk(t, 'shop_id', 'shops')));
    expect(edges).toEqual([]);
  });

  it('ignores self-referencing foreign keys', () => {
    const edges = expandableForeignKeys([fk('messages', 'reply_to_id', 'messages')]);
    expect(edges).toEqual([]);
  });
});

describe('purge-test-account delete ordering', () => {
  const SCHEMA = [
    fk('shops', 'tenant_id', 'tenants'),
    fk('user_shops', 'shop_id', 'shops'),
    fk('user_shops', 'user_id', 'users'),
    fk('products', 'shop_id', 'shops'),
    fk('order_items', 'product_id', 'products'),
    fk('order_items', 'order_id', 'orders'),
    fk('orders', 'shop_id', 'shops'),
    fk('orders', 'customer_id', 'customers'),
    fk('customers', 'shop_id', 'shops'),
  ];

  const tables = ['tenants', 'shops', 'users', 'user_shops', 'products', 'orders', 'order_items', 'customers'];

  it('emits every child before the row it points at', () => {
    const order = topologicalOrder(tables, SCHEMA);
    const position = new Map(order.map((t, i) => [t, i]));

    expect(order).toHaveLength(tables.length);
    for (const edge of SCHEMA) {
      expect(position.get(edge.child_table)).toBeLessThan(position.get(edge.parent_table));
    }
  });

  it('puts the roots last, so a missed dependant fails loudly on the FK', () => {
    const order = topologicalOrder(tables, SCHEMA);
    expect(order[order.length - 1]).toBe('tenants');
    expect(order.indexOf('shops')).toBeGreaterThan(order.indexOf('products'));
  });

  it('refuses to guess an order when the graph has a cycle', () => {
    const cyclic = [fk('a', 'b_id', 'b'), fk('b', 'a_id', 'a')];
    expect(() => topologicalOrder(['a', 'b'], cyclic)).toThrow(/cycle/i);
  });

  it('ignores edges pointing outside the scoped table set', () => {
    const order = topologicalOrder(['products', 'shops'], SCHEMA);
    expect(order).toEqual(['products', 'shops']);
  });
});
