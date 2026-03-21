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
