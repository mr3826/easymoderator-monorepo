const orderValidator = require('../order.validator');

describe('order.validator', () => {
  describe('updateOrder', () => {
    it('accepts REST path id with update body (no body orderId required)', () => {
      const paramsResult = orderValidator.updateOrder.params.validate({
        id: '550e8400-e29b-41d4-a716-446655440000'
      });
      const bodyResult = orderValidator.updateOrder.body.validate({
        order_status: 'confirmed'
      });

      expect(paramsResult.error).toBeUndefined();
      expect(bodyResult.error).toBeUndefined();
    });

    it('rejects empty update payload', () => {
      const bodyResult = orderValidator.updateOrder.body.validate({});
      expect(bodyResult.error).toBeDefined();
    });
  });

  describe('createOrder', () => {
    const base = {
      customer_name: 'Rahim',
      customer_phone: '01712345678',
      items: [{ product_id: '550e8400-e29b-41d4-a716-446655440000', quantity: 1, price: 250 }]
    };

    it('accepts the structured BD address object the manual-order form sends', () => {
      // Regression: the app posts delivery_address as an object; the validator used
      // to require a string, rejecting every manual order with a 400.
      const result = orderValidator.createOrder.body.validate({
        ...base,
        delivery_address: {
          division: 'Dhaka',
          district: 'Dhaka',
          upazila: 'Dhanmondi',
          street_address: 'House 12, Road 5',
          zone: 'inside_dhaka'
        }
      });
      expect(result.error).toBeUndefined();
    });

    it('still accepts a legacy free-text address string', () => {
      const result = orderValidator.createOrder.body.validate({
        ...base,
        delivery_address: 'House 12, Road 5, Dhanmondi, Dhaka'
      });
      expect(result.error).toBeUndefined();
    });

    it('rejects a non-address value type for delivery_address', () => {
      const result = orderValidator.createOrder.body.validate({
        ...base,
        delivery_address: 12345
      });
      expect(result.error).toBeDefined();
    });
  });

  describe('legacyGet', () => {
    it('accepts id aliases', () => {
      const byOrderId = orderValidator.legacyGet.query.validate({
        order_id: '550e8400-e29b-41d4-a716-446655440000'
      });
      const byId = orderValidator.legacyGet.query.validate({
        id: '550e8400-e29b-41d4-a716-446655440000'
      });

      expect(byOrderId.error).toBeUndefined();
      expect(byId.error).toBeUndefined();
    });

    it('rejects missing ids', () => {
      const result = orderValidator.legacyGet.query.validate({});
      expect(result.error).toBeDefined();
    });
  });
});
