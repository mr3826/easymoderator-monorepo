'use strict';

const express = require('express');
const request = require('supertest');
const router = require('../subscription-plans.routes');

const app = express();
app.use('/api/subscription/plans', router);

describe('public subscription plans endpoint', () => {
    it('returns all commercial plans without authentication', async () => {
        const response = await request(app).get('/api/subscription/plans');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.map((plan) => plan.code)).toEqual(['SHURU', 'GROWTH', 'PARTNER']);
        expect(response.body.data.find((plan) => plan.code === 'GROWTH')).toEqual(expect.objectContaining({
            price_bdt_monthly: 999,
            conversations_limit: 500,
            can_purchase_topups: true,
        }));
    });
});
