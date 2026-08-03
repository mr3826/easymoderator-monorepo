'use strict';

/**
 * Synthetic BD f-commerce merchant fixture for AI-cost measurement.
 *
 * Shapes match the real entities the reply path reads:
 *  - products    → product-search.service.formatProductsForLlm()
 *  - faqs        → knowledge.service.formatFaq() output consumed by buildSystemPrompt()
 *  - businessInfo→ shop.settings.businessInfo
 *  - history     → conversation Message rows (last 10, verbatim)
 *
 * Entirely synthetic. No production data, no PII, no real phone numbers
 * (01700000000 is the seed placeholder already used by render-production-env.js).
 */

const CATEGORIES = ['Saree', 'Three Piece', 'Kurti', 'Panjabi', 'Shirt', 'Bag'];

const NAMES = [
    ['Cotton Jamdani Saree', 'কটন জামদানি শাড়ি', 'Saree', 2350],
    ['Silk Katan Saree', 'সিল্ক কাতান শাড়ি', 'Saree', 4200],
    ['Half Silk Tangail Saree', 'হাফ সিল্ক টাঙ্গাইল শাড়ি', 'Saree', 1850],
    ['Dhakai Muslin Saree', 'ঢাকাই মসলিন শাড়ি', 'Saree', 6500],
    ['Block Print Cotton Saree', 'ব্লক প্রিন্ট কটন শাড়ি', 'Saree', 1450],
    ['Embroidered Three Piece', 'এমব্রয়ডারি থ্রি পিস', 'Three Piece', 2100],
    ['Lawn Cotton Three Piece', 'লন কটন থ্রি পিস', 'Three Piece', 1650],
    ['Karchupi Three Piece', 'কারচুপি থ্রি পিস', 'Three Piece', 3200],
    ['Unstitched Cotton Salwar', 'আনস্টিচড কটন সালোয়ার', 'Three Piece', 1250],
    ['Party Wear Three Piece', 'পার্টি ওয়্যার থ্রি পিস', 'Three Piece', 2850],
    ['Printed Kurti', 'প্রিন্টেড কুর্তি', 'Kurti', 950],
    ['Linen Straight Kurti', 'লিনেন স্ট্রেইট কুর্তি', 'Kurti', 1150],
    ['Anarkali Kurti', 'আনারকলি কুর্তি', 'Kurti', 1750],
    ['Black Georgette Kurti', 'কালো জর্জেট কুর্তি', 'Kurti', 1250],
    ['Denim Kurti', 'ডেনিম কুর্তি', 'Kurti', 1350],
    ['Cotton Panjabi', 'কটন পাঞ্জাবি', 'Panjabi', 1400],
    ['Silk Panjabi', 'সিল্ক পাঞ্জাবি', 'Panjabi', 2600],
    ['Embroidered Panjabi', 'এমব্রয়ডারি পাঞ্জাবি', 'Panjabi', 1950],
    ['Kabli Set', 'কাবলি সেট', 'Panjabi', 3100],
    ['Casual Panjabi', 'ক্যাজুয়াল পাঞ্জাবি', 'Panjabi', 1100],
    ['Formal Shirt', 'ফরমাল শার্ট', 'Shirt', 1200],
    ['Check Casual Shirt', 'চেক ক্যাজুয়াল শার্ট', 'Shirt', 1050],
    ['Half Sleeve Polo', 'হাফ স্লিভ পোলো', 'Shirt', 850],
    ['Denim Shirt', 'ডেনিম শার্ট', 'Shirt', 1450],
    ['Linen Shirt', 'লিনেন শার্ট', 'Shirt', 1650],
    ['Leather Side Bag', 'লেদার সাইড ব্যাগ', 'Bag', 1900],
    ['Jute Tote Bag', 'জুট টোট ব্যাগ', 'Bag', 650],
    ['Canvas Backpack', 'ক্যানভাস ব্যাকপ্যাক', 'Bag', 2200],
    ['Clutch Purse', 'ক্লাচ পার্স', 'Bag', 750],
    ['Travel Duffel Bag', 'ট্রাভেল ডাফেল ব্যাগ', 'Bag', 2750],
];

const SIZES = ['S', 'M', 'L', 'XL'];
const COLORS = ['Black', 'Maroon', 'Navy', 'Off White', 'Olive'];

const products = NAMES.map(([name, name_bn, category, price], i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name,
    name_bn,
    category,
    price,
    compare_at_price: i % 4 === 0 ? price + 300 : null,
    quantity: i % 7 === 0 ? 0 : 5 + (i % 20),
    in_stock: i % 7 !== 0,
    is_active: true,
    brand: i % 3 === 0 ? 'Rongdhonu' : null,
    sku: `RD-${1000 + i}`,
    tags: ['bangladeshi', category.toLowerCase().replace(/\s+/g, '-'), 'eid-collection'],
    variants: category === 'Bag'
        ? []
        : SIZES.slice(0, 2 + (i % 3)).map((size) => ({ size, option: 'Size', value: size }))
            .concat(COLORS.slice(0, 2).map((c) => ({ option: 'Color', value: c }))),
    description: `${name} — soft, breathable fabric suited to Bangladeshi weather. Machine washable, colour-fast. Ideal for daily wear and festive occasions.`,
    ai_description: `A ${COLORS[i % COLORS.length].toLowerCase()} ${category.toLowerCase()} with a clean traditional finish.`,
    ai_tags: ['traditional', 'festive', COLORS[i % COLORS.length].toLowerCase()],
    ai_category: category,
    ai_color_primary: COLORS[i % COLORS.length],
    ai_material: category === 'Bag' ? 'leather' : 'cotton',
    ai_attributes: { style: i % 2 === 0 ? 'traditional' : 'casual' },
}));

/** Shape produced by knowledge.service.formatFaq() and consumed by buildSystemPrompt(). */
const faqs = [
    { category: 'Delivery Charge', template_en: 'Inside Dhaka 60 BDT, outside Dhaka 120 BDT. Delivery takes 1-2 days inside Dhaka and 2-3 days outside.', template_bn: 'ঢাকার ভিতরে ৬০ টাকা, ঢাকার বাইরে ১২০ টাকা। ঢাকায় ১-২ দিন, বাইরে ২-৩ দিন লাগে।' },
    { category: 'Payment Method', template_en: 'We accept Cash on Delivery only. You pay when the product reaches you.', template_bn: 'আমরা শুধু ক্যাশ অন ডেলিভারি নিই। প্রোডাক্ট হাতে পেয়ে টাকা দিবেন।' },
    { category: 'Return Policy', template_en: 'Returns accepted within 3 days if the product is damaged or wrong. Please record an unboxing video.', template_bn: 'প্রোডাক্ট নষ্ট বা ভুল হলে ৩ দিনের মধ্যে ফেরত নেওয়া হয়। আনবক্সিং ভিডিও রাখবেন।' },
    { category: 'Size Chart', template_en: 'S=36, M=38, L=40, XL=42 chest in inches. If unsure, order one size up.', template_bn: 'S=৩৬, M=৩৮, L=৪০, XL=৪২ ইঞ্চি বুকের মাপ। নিশ্চিত না হলে এক সাইজ বড় নিন।' },
    { category: 'Order Confirmation', template_en: 'After you place an order we call to confirm within 2 hours during business hours.', template_bn: 'অর্ডার করার পর অফিস সময়ে ২ ঘণ্টার মধ্যে কল করে কনফার্ম করা হয়।' },
    { category: 'Exchange', template_en: 'Size exchange is available within 3 days; the customer covers the return courier charge.', template_bn: 'সাইজ এক্সচেঞ্জ ৩ দিনের মধ্যে করা যায়; রিটার্ন কুরিয়ার চার্জ ক্রেতা দিবেন।' },
    { category: 'Fabric Care', template_en: 'Hand wash cold for the first wash. Do not bleach. Dry in shade to protect the colour.', template_bn: 'প্রথম ধোয়া ঠান্ডা পানিতে হাতে করবেন। ব্লিচ দিবেন না। ছায়ায় শুকাবেন।' },
    { category: 'Bulk Order', template_en: 'For 10+ pieces we offer a 12% discount. Message us with the quantity.', template_bn: '১০ পিসের বেশি নিলে ১২% ছাড় দেওয়া হয়। পরিমাণ জানিয়ে মেসেজ দিন।' },
    { category: 'Stock Update', template_en: 'New stock arrives every Sunday and Wednesday. Follow the page for restock posts.', template_bn: 'প্রতি রবি ও বুধবার নতুন স্টক আসে। রিস্টক পোস্টের জন্য পেজ ফলো করুন।' },
    { category: 'Delivery Area', template_en: 'We deliver to all 64 districts of Bangladesh via Steadfast courier.', template_bn: 'স্টেডফাস্ট কুরিয়ারে বাংলাদেশের ৬৪ জেলাতেই ডেলিভারি দেওয়া হয়।' },
    { category: 'Cancel Order', template_en: 'Orders can be cancelled before dispatch. After dispatch the courier charge applies.', template_bn: 'ডিসপ্যাচের আগে অর্ডার ক্যান্সেল করা যায়। ডিসপ্যাচের পর কুরিয়ার চার্জ প্রযোজ্য।' },
    { category: 'Advance Payment', template_en: 'No advance payment is required for regular orders inside Bangladesh.', template_bn: 'বাংলাদেশের ভিতরে সাধারণ অর্ডারে কোনো অগ্রিম পেমেন্ট লাগে না।' },
];

const businessInfo = {
    shopName: 'Rongdhonu Fashion',
    description: 'Bangladeshi ethnic wear and everyday fashion, sourced from Narayanganj and Tangail weavers.',
    address: 'Shop 214, Level 3, Bashundhara City Shopping Complex, Panthapath, Dhaka 1215',
    phone: '01700000000',
    openingHours: 'Saturday–Thursday 10:00–21:00, Friday 15:00–21:00',
    additionalInfo: 'Family-run since 2019. We photograph every product ourselves, so colours are accurate to within one shade.',
    socialLinks: {
        facebook: 'https://facebook.com/rongdhonufashion',
        instagram: 'https://instagram.com/rongdhonufashion',
    },
};

/** RAG chunks as stored by auto-index.job.js (business_info excluded at read time). */
const knowledgeChunks = [
    'Q: Delivery Charge\nA (BN): ঢাকার ভিতরে ৬০ টাকা, ঢাকার বাইরে ১২০ টাকা। ঢাকায় ১-২ দিন, বাইরে ২-৩ দিন লাগে।\nA (EN): Inside Dhaka 60 BDT, outside Dhaka 120 BDT. Delivery takes 1-2 days inside Dhaka and 2-3 days outside.',
    'Q: Return Policy\nA (BN): প্রোডাক্ট নষ্ট বা ভুল হলে ৩ দিনের মধ্যে ফেরত নেওয়া হয়। আনবক্সিং ভিডিও রাখবেন।\nA (EN): Returns accepted within 3 days if the product is damaged or wrong. Please record an unboxing video.',
    'Delivery and courier policy: Rongdhonu Fashion ships via Steadfast to all 64 districts. Dhaka metro orders dispatched same day if confirmed before 4pm. Outside Dhaka dispatched next working day. Tracking code is shared on the Messenger thread once the parcel is picked up. Partial delivery is not supported — the full order ships together.',
    'Size and fit guidance: Our three piece sets run true to Bangladeshi standard sizing. S fits 36 inch chest, M 38, L 40, XL 42. Saree blouse pieces are unstitched and come with 0.8 metre fabric. Kurti lengths are 40 inches for S/M and 42 inches for L/XL. If a customer is between sizes we recommend the larger one, and size exchange is free within 3 days excluding courier charge.',
];

/** Last 10 conversation messages, verbatim, as loadConversationHistory() returns them. */
const history = [
    { role: 'user', content: 'Assalamu alaikum' },
    { role: 'assistant', content: 'Assalamu alaikum! Ki help korbo apnake? 😊' },
    { role: 'user', content: 'apnader kurti gulo dekhte chai' },
    { role: 'assistant', content: 'Ji apu, amader kurti collection e printed, linen straight, anarkali ar denim kurti ache. Dam 950 theke 1750 taka. Kon ta dekhte chan? 😊' },
    { role: 'user', content: 'kalo rong er ta ache?' },
    { role: 'assistant', content: 'Ji, Black Georgette Kurti ache — dam 1250 taka, stock e ache 😊' },
    { role: 'user', content: 'medium size hobe?' },
    { role: 'assistant', content: 'Ji apu, medium size available ache. Chest 38 inch, length 40 inch.' },
    { role: 'user', content: 'delivery koto din lage ar charge koto?' },
    { role: 'assistant', content: 'Dhaka te 1-2 din, Dhaka er baire 2-3 din lage. Charge Dhaka te 60 taka, baire 120 taka 😊' },
];

module.exports = { products, faqs, businessInfo, knowledgeChunks, history, CATEGORIES };
