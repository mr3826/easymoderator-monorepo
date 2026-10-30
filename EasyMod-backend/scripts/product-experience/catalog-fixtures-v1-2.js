'use strict';

// Synthetic merchant evidence only. Evaluator expectations and image labels
// belong in tests and must never be added to model-visible catalog records.
const FAMILIES = [
    {
        id: 'kamiz',
        name: "Women's Embroidered Kamiz",
        nameBn: 'নারীদের এমব্রয়ডারি কামিজ',
        aliases: ['embroidered kamiz', 'embroidered kameez', 'kameez', 'kamij', 'kamiz', 'ladies kamiz', 'এমব্রয়ডারি কামিজ', 'কামিজ'],
        basePrice: 1850,
        colors: ['lavender', 'mauve'],
        sizes: ['S', 'M', 'L', 'XL', 'XXL'],
        material: ['cotton blend', 'silk blend'],
    },
    {
        id: 'panjabi',
        name: 'Premium Black Panjabi',
        nameBn: 'প্রিমিয়াম কালো পাঞ্জাবি',
        aliases: ['black panjabi', 'black punjabi', 'panjabi', 'punjabi', 'কালো পাঞ্জাবি', 'পাঞ্জাবি', 'পাঞ্জাবী'],
        basePrice: 2850,
        colors: ['black', 'black'],
        sizes: ['38', '40', '42', '44'],
        material: ['cotton blend', 'silk blend'],
    },
    {
        id: 'cargo',
        name: 'Olive Cargo Pant',
        nameBn: 'অলিভ কার্গো প্যান্ট',
        aliases: ['cargo pant', 'cargo pants', 'cargo trousers', 'cargo trouser', 'olive cargo pant', 'কার্গো প্যান্ট', 'অলিভ কার্গো প্যান্ট'],
        basePrice: 1450,
        colors: ['olive', 'olive'],
        sizes: ['30', '32', '34', '36'],
        material: [null, null],
    },
    {
        id: 'denim',
        name: 'Classic Blue Denim Jacket',
        nameBn: 'ক্লাসিক নীল ডেনিম জ্যাকেট',
        aliases: ['denim jacket', 'blue denim jacket', 'blue denim', 'jeans jacket', 'ডেনিম জ্যাকেট', 'নীল ডেনিম জ্যাকেট'],
        basePrice: 3200,
        colors: ['blue', 'blue'],
        sizes: ['S', 'M', 'L', 'XL'],
        material: ['cotton blend', 'silk blend'],
    },
];

const createV12Catalog = () => ['a', 'b'].flatMap((tenant, tenantIndex) => FAMILIES.map(family => {
    const price = family.basePrice + tenantIndex * 500;
    const color = family.colors[tenantIndex];
    const sizes = family.sizes.map((size, index) => ({
        id: `v12-${tenant}-${family.id}-${size.toLocaleLowerCase()}`,
        size,
        color,
        // Null is intentional: the production evidence layer inherits the
        // parent price for this SKU. A distinct XL/XXL price remains explicit.
        price: ['XL', 'XXL'].includes(size) ? price + 100 : null,
        quantity: tenantIndex ? 0 : (index === 2 ? null : Math.max(1, 4 - index)),
        is_active: true,
    }));

    return {
        id: `v12-${tenant}-${family.id}`,
        shop_id: `fixture-shop-${tenant}`,
        name: family.name,
        name_bn: family.nameBn,
        aliases: [...family.aliases, `${color} ${family.id}`],
        is_active: true,
        price,
        currency: 'BDT',
        track_quantity: true,
        quantity: tenantIndex ? 0 : 4,
        in_stock: !tenantIndex,
        verifiedMaterial: family.material[tenantIndex],
        verifiedColor: color,
        variants: sizes,
    };
}));

module.exports = { createV12Catalog };
