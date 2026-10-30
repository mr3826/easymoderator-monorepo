'use strict';

jest.mock('../shop.entity', () => ({
    findByPk: jest.fn(),
}));

const Shop = require('../shop.entity');
const { getBdSettings } = require('../shop-bd-settings');

beforeEach(() => {
    jest.clearAllMocks();
});

test('reads the default-exported Shop model and merges the shop BD settings', async () => {
    Shop.findByPk.mockResolvedValue({
        settings: {
            bd: {
                mfs_mode: 'self',
                mfs_type: 'bkash',
                mfs_number: '01711111111',
                google_sheet_range: 'Inventory!A:F',
            },
        },
    });

    const settings = await getBdSettings('shop-e2e-id');

    expect(Shop.findByPk).toHaveBeenCalledWith('shop-e2e-id', {
        attributes: ['id', 'settings'],
    });
    expect(settings).toMatchObject({
        mfs_mode: 'self',
        mfs_type: 'bkash',
        mfs_number: '01711111111',
        google_sheet_range: 'Inventory!A:F',
        google_sheet_id: null,
    });
});

test('returns safe BD defaults when the shop does not exist', async () => {
    Shop.findByPk.mockResolvedValue(null);

    await expect(getBdSettings('missing-shop')).resolves.toMatchObject({
        mfs_mode: null,
        mfs_type: null,
        mfs_number: null,
        google_sheet_id: null,
        google_sheet_range: 'Sheet1!A:Z',
    });
});
