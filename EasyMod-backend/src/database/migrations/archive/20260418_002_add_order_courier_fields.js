'use strict';

module.exports = {
  name: '20260418_002_add_order_courier_fields',

  up: async (sequelize) => {
    const qi = sequelize.getQueryInterface();
    const alreadyExists = (e) =>
      /constraint|already exists|duplicate|column.*already/i.test(e.message);

    const columns = [
      ['delivery_provider', 'TEXT'],
      ['delivery_consignment_id', 'TEXT'],
      ['delivery_tracking_code', 'TEXT'],
      ['delivery_dispatched_at', 'TIMESTAMPTZ'],
    ];

    for (const [col, type] of columns) {
      try {
        await qi.addColumn('orders', col, { type, allowNull: true });
        console.log(`  ✓ orders.${col} added`);
      } catch (err) {
        if (alreadyExists(err)) {
          console.log(`  · orders.${col} already exists, skipping`);
        } else {
          throw err;
        }
      }
    }
  },

  down: async (sequelize) => {
    const qi = sequelize.getQueryInterface();
    for (const col of ['delivery_provider', 'delivery_consignment_id', 'delivery_tracking_code', 'delivery_dispatched_at']) {
      try { await qi.removeColumn('orders', col); } catch (_) {}
    }
  },
};
