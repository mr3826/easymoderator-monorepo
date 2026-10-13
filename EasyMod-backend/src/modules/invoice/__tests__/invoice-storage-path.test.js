const fs = require('fs');
const path = require('path');

const subscriptionInvoiceSource = fs.readFileSync(
    path.resolve(__dirname, '../../subscription/invoice.service.js'),
    'utf8',
);
const orderInvoiceSource = fs.readFileSync(
    path.resolve(__dirname, '../invoice.service.js'),
    'utf8',
);

describe('production invoice storage paths', () => {
    test('both invoice services target the persistent backend uploads volume', () => {
        const persistentPath = "path.join(__dirname, '../../../uploads/invoices')";

        expect(subscriptionInvoiceSource).toContain(persistentPath);
        expect(orderInvoiceSource).toContain(persistentPath);
    });

    test('preserves existing invoice URL contracts', () => {
        expect(subscriptionInvoiceSource).toContain('const fileUrl = `/invoices/${filename}`');
        expect(orderInvoiceSource).toContain("joinOrigin(getOrigins().publicAssets, `/uploads/invoices/${fileName}`)");
    });
});
