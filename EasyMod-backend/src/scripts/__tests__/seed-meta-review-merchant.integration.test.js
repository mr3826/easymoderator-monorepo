'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { sequelize } = require('../../utils/database/database-setup');
const entities = require('../../modules/entities');
const { comparePassword } = require('../../utils/password.util');
const authService = require('../../modules/auth/auth.service');
const media = require('../../modules/product/product-media.service');
const { searchForOrder } = require('../../modules/product/product-search.service');
const {
    runMetaReviewMerchantSeed,
    stableId,
} = require('../seed-meta-review-merchant');

const PASSWORD = 'integration-only-secret';

const migrateAndSync = async () => {
    execFileSync(process.execPath, [path.join(__dirname, '../../database/migrate.js'), 'up'], {
        cwd: path.join(__dirname, '../../..'),
        env: process.env,
        stdio: 'pipe',
    });
    await sequelize.sync();
};

const alterSettingsType = async (type) => {
    await sequelize.query('ALTER TABLE shops ALTER COLUMN settings DROP DEFAULT');
    await sequelize.query(`ALTER TABLE shops ALTER COLUMN settings TYPE ${type.toUpperCase()} USING settings::${type}`);
};

const makeSeedDependencies = () => ({
    sequelize,
    entities,
    password: PASSWORD,
    hashPassword: async (value) => require('../../utils/password.util').hashPassword(value),
    comparePassword,
    safeFetchMedia: async () => ({
        buffer: Buffer.from('integration-image-bytes'),
        mimeType: 'image/jpeg',
    }),
    storeProductImage: (() => {
        let imageNumber = 0;
        return async ({ shopId }) => {
            imageNumber += 1;
            return { publicPath: `/uploads/product-images/${shopId}/integration-${imageNumber}.jpg` };
        };
    })(),
    removeUnreferencedProductMedia: async () => ({ removed: 0, bytes: 0 }),
    getProductMediaPaths: media.getProductMediaPaths,
    uploadRoot: require('../../utils/image-upload.service').UPLOAD_ROOT,
    embedProduct: async () => true,
    searchForOrder,
    env: { NODE_ENV: 'test' },
    now: new Date('2026-09-02T09:00:00.000Z'),
    imageExists: async ({ product }) => Boolean(product.image_url),
});

describe('seed-meta-review-merchant against disposable PostgreSQL', () => {
    beforeAll(async () => {
        await migrateAndSync();
        await alterSettingsType('json');
    });

    afterAll(async () => {
        const { User, Tenant, Shop, UserShop, Subscription, Invoice, Product } = entities;
        const shopId = stableId('shop');
        const tenantId = stableId('tenant');
        const userId = stableId('user');
        await Invoice.destroy({ where: { subscription_id: stableId('subscription') }, force: true });
        await Subscription.destroy({ where: { id: stableId('subscription') }, force: true });
        await Product.destroy({ where: { shop_id: shopId }, force: true });
        await UserShop.destroy({ where: { shop_id: shopId }, force: true });
        await Shop.destroy({ where: { id: shopId }, force: true });
        await Tenant.destroy({ where: { id: tenantId }, force: true });
        await User.destroy({ where: { id: userId }, force: true });
        await alterSettingsType('jsonb');
    });

    it('passes on JSON, reruns on JSONB, preserves Meta-shaped settings, and keeps tenant scope', async () => {
        const dependencies = makeSeedDependencies();
        const first = await runMetaReviewMerchantSeed(dependencies);
        expect(first.productCount).toBe(5);
        expect(first.shop.settings.ai.automation_mode).toBe('MANUAL');

        const user = await entities.User.findByPk(first.user.id);
        expect(await comparePassword(PASSWORD, user.password)).toBe(true);
        expect(user.platform_role).toBeNull();
        const [accountFlags] = await sequelize.query(
            'SELECT is_verified, is_active FROM users WHERE id = :userId',
            { replacements: { userId: user.id } },
        );
        expect(accountFlags[0]).toMatchObject({ is_verified: true, is_active: true });
        expect(await entities.UserShop.count({ where: { user_id: user.id, shop_id: first.shop.id, role: 'owner' } })).toBe(1);
        expect(await entities.UserShop.count({ where: { user_id: user.id, shop_id: { [require('sequelize').Op.ne]: stableId('shop') } } })).toBe(0);
        const login = await authService.authenticateUser('merchant@easymod.tech', PASSWORD);
        expect(login.currentShop).toMatchObject({ id: first.shop.id, role: 'owner' });

        const shop = await entities.Shop.findByPk(first.shop.id);
        await shop.update({
            settings: {
                ...shop.settings,
                meta: { page_id: 'founder-page', encrypted_page_token: 'ciphertext' },
            },
        });
        await alterSettingsType('jsonb');

        const second = await runMetaReviewMerchantSeed(dependencies);
        const products = await entities.Product.findAll({ where: { shop_id: second.shop.id } });
        const invoices = await entities.Invoice.findAll({ where: { subscription_id: second.subscription.id } });
        const reloadedShop = await entities.Shop.findByPk(second.shop.id);

        expect(second.productCount).toBe(5);
        expect(products).toHaveLength(5);
        expect(invoices).toHaveLength(2);
        expect(invoices.map((invoice) => invoice.billing_period).sort()).toEqual(['2026-09', '2026-10']);
        expect(invoices.every((invoice) => invoice.status === 'paid')).toBe(true);
        expect(reloadedShop.settings.meta).toEqual({ page_id: 'founder-page', encrypted_page_token: 'ciphertext' });
        expect(reloadedShop.settings.ai.automation_mode).toBe('MANUAL');
    });
});
