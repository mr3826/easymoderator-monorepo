const { Tenant, Shop } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');

const getTenantById = async (tenantId) => {
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant) {
        throw new AppError('Tenant not found', 404);
    }
    return tenant;
};

const getTenantShop = async (tenantId, shopId) => {
    const tenant = await getTenantById(tenantId);
    const shop = await Shop.findOne({
        where: {
            id: shopId,
            tenant_id: tenantId
        }
    });

    if (!shop) {
        throw new AppError('Shop not found for tenant', 404);
    }

    return { tenant, shop };
};

module.exports = {
    getTenantById,
    getTenantShop
};
