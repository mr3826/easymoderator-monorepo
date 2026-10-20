'use strict';

const { FactState, ProductEvidenceStatus, MediaStatus } = require('../grounding/grounding.contract');
const { isTenantOwnedMediaUrl } = require('../grounding/product-evidence.service');

const SCHEMA_VERSION = '1';
const DEFAULT_CURRENCY = 'BDT';

const factDto = (fact) => {
    if (!fact || fact.state === FactState.UNKNOWN) return { state: 'UNKNOWN', value: null };
    if (fact.state === FactState.UNCERTAIN) return { state: 'UNCERTAIN', value: fact.value ?? null };
    return { state: 'KNOWN', value: fact.value ?? null };
};

const priceDto = (fact, currency) => {
    if (!fact || fact.state !== FactState.KNOWN || !Number.isFinite(Number(fact.value))) {
        return { state: 'UNKNOWN', amount: null, currency };
    }
    return { state: 'KNOWN', amount: Number(fact.value), currency };
};

const normalizeLanguage = (language) => {
    const value = String(language || '').trim().toLowerCase();
    if (['bn', 'bangla', 'bengali', 'বাংলা'].includes(value)) return 'bn';
    if (['en', 'english'].includes(value)) return 'en';
    return 'mixed';
};

const optionValueAppears = (message, value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(String(message || ''));
};

const OPTION_REQUEST_STOP_WORDS = new Set([
    'price', 'cost', 'stock', 'available', 'availability', 'option', 'variant',
    'size', 'sizes', 'color', 'colour', 'দাম', 'মূল্য', 'কত', 'আছে', 'স্টক', 'সাইজ', 'রং',
]);

const resolveRequestedVariant = (variants, message) => {
    if (!message) return { variant: null, explicit: false };
    const matches = variants.filter(variant => optionValueAppears(message, variant.value));
    if (matches.length === 1) return { variant: matches[0], explicit: true };
    if (matches.length > 1) return { variant: null, explicit: true };

    const optionLabel = String.raw`(?:size|sizes|color|colour|variant|option|সাইজ|রং)`;
    const request = String(message).match(new RegExp(
        String.raw`(?:^|[^\p{L}\p{N}])${optionLabel}(?![\p{L}\p{N}])\s*[:=-]?\s*([\p{L}\p{N}-]+)|([\p{L}\p{N}-]+)\s+(?:${optionLabel})(?![\p{L}\p{N}])`,
        'iu',
    ));
    const requestedValue = request?.[1] || request?.[2] || null;
    const explicitUnknown = requestedValue
        && !OPTION_REQUEST_STOP_WORDS.has(requestedValue.toLocaleLowerCase());
    return { variant: null, explicit: Boolean(explicitUnknown) };
};

const buildProductPresentation = (evidence, {
    currency = DEFAULT_CURRENCY,
    message = '',
    language = 'mixed',
    selectedVariants = {},
} = {}) => {
    const normalizedLanguage = normalizeLanguage(language);
    const verified = evidence?.productStatus === ProductEvidenceStatus.VERIFIED
        ? (evidence.verifiedProducts || []).filter(product =>
            product && product.id && product.shopId && String(product.shopId) === String(evidence.shopId))
        : [];
    const products = verified.map(product => {
        const facts = product.facts || {};
        const imageUrl = isTenantOwnedMediaUrl(product.imageUrl, product.shopId) ? product.imageUrl : null;
        const variants = (Array.isArray(facts.variants) ? facts.variants : []).map(variant => ({
            id: variant.id || null,
            option: variant.optionName || 'Variant',
            value: variant.optionValue || null,
            price: priceDto(variant.price, currency),
            availability: factDto(variant.availability),
            image: isTenantOwnedMediaUrl(variant.imageUrl, product.shopId)
                ? { state: 'AVAILABLE', url: variant.imageUrl }
                : { state: 'UNKNOWN', url: null },
        }));
        const currentRequest = resolveRequestedVariant(variants.filter(variant => variant.id), message);
        const priorSelectionId = selectedVariants?.[String(product.id)]?.id
            || selectedVariants?.[String(product.id)]?.variantId;
        const priorSelection = priorSelectionId
            ? variants.find(variant => String(variant.id) === String(priorSelectionId)) || null
            : null;
        // A current request wins, including an unknown or conflicting choice:
        // never answer a request for L using the prior XL selection. A prior
        // selection is carried only when the current message names no option.
        const selected = currentRequest.variant
            || (!currentRequest.explicit ? priorSelection : null);
        const variantPrices = variants.map(variant => variant.price);
        const distinctPrices = new Set(variantPrices
            .filter(price => price.state === 'KNOWN')
            .map(price => `${price.currency}:${price.amount}`));
        const missingVariantPrice = variants.some(variant => variant.price.state !== 'KNOWN');
        const parentPrice = priceDto(facts.price, currency);
        const variantPriceDiffersFromParent = parentPrice.state === 'KNOWN'
            && variantPrices.some(price => price.state === 'KNOWN' && price.amount !== parentPrice.amount);
        const productPrice = selected
            ? selected.price
            : (variants.length > 0 && (distinctPrices.size > 1 || missingVariantPrice || variantPriceDiffersFromParent)
                ? { state: 'UNKNOWN', amount: null, currency }
                : parentPrice);
        return {
            id: String(product.id),
            shopId: String(product.shopId),
            title: String(product.name || '').trim(),
            titleBn: String(product.nameBn || '').trim() || null,
            price: productPrice,
            selectedVariant: selected
                ? { id: selected.id, option: selected.option, value: selected.value }
                : null,
            attributes: {
                material: factDto(facts.material),
                color: factDto(facts.color),
                size: factDto(facts.size || facts.sizes),
                stock: factDto(facts.stock),
            },
            variants,
            image: imageUrl ? { state: 'AVAILABLE', url: imageUrl } : { state: 'UNKNOWN', url: null },
            detailLink: { state: 'UNKNOWN', url: null },
        };
    });
    const selection = products.length === 1 ? 'SINGLE' : products.length > 1 ? 'MULTIPLE' : 'NONE';
    const mediaProduct = products.find(product =>
        evidence?.mediaStatus === MediaStatus.AVAILABLE
        && String(evidence.mediaProductId) === product.id
        && product.image.state === 'AVAILABLE'
        && product.image.url === evidence.mediaUrl
        && (evidence.allowedUrls || []).includes(evidence.mediaUrl));

    return {
        schemaVersion: SCHEMA_VERSION,
        language: normalizedLanguage,
        status: products.length ? 'READY' : 'BLOCKED',
        shopId: evidence?.shopId ? String(evidence.shopId) : null,
        selection,
        products,
        media: mediaProduct
            ? { state: 'AVAILABLE', productId: mediaProduct.id, url: mediaProduct.image.url }
            : { state: evidence?.mediaStatus || MediaStatus.NOT_REQUESTED, productId: null, url: null },
        detailLink: { state: 'UNKNOWN', url: null },
    };
};

const validateProductPresentation = (presentation) => {
    const issues = [];
    if (!presentation || presentation.schemaVersion !== SCHEMA_VERSION) issues.push('schema_version_invalid');
    if (!presentation?.shopId) issues.push('shop_id_missing');
    if (!['bn', 'en', 'mixed'].includes(presentation?.language)) issues.push('language_invalid');
    if (!['READY', 'BLOCKED'].includes(presentation?.status)) issues.push('status_invalid');
    if (!['SINGLE', 'MULTIPLE', 'NONE'].includes(presentation?.selection)) issues.push('selection_invalid');
    if (!Array.isArray(presentation?.products)) issues.push('products_invalid');
    const products = Array.isArray(presentation?.products) ? presentation.products : [];
    const expectedSelection = products.length === 1 ? 'SINGLE' : products.length > 1 ? 'MULTIPLE' : 'NONE';
    if (presentation?.selection !== expectedSelection) issues.push('selection_count_mismatch');
    if ((presentation?.status === 'READY') !== (products.length > 0)) issues.push('status_product_mismatch');
    for (const product of products) {
        if (!product.id || String(product.shopId) !== String(presentation.shopId)) issues.push('product_shop_mismatch');
        if (!product.title) issues.push('product_title_missing');
        const validateFact = (fact, name) => {
            if (!fact || !['KNOWN', 'UNKNOWN', 'UNCERTAIN'].includes(fact.state)) issues.push(`${name}_state_invalid`);
            if (fact?.state === 'UNKNOWN' && fact.value !== null) issues.push(`${name}_unknown_has_value`);
        };
        const validatePrice = (price, name) => {
            if (!price || !['KNOWN', 'UNKNOWN'].includes(price.state)) issues.push(`${name}_state_invalid`);
            if (price?.state === 'KNOWN' && (!Number.isFinite(price.amount) || price.amount < 0 || price.currency !== DEFAULT_CURRENCY)) {
                issues.push(`${name}_invalid`);
            }
            if (price?.state === 'UNKNOWN' && price.amount !== null) issues.push(`${name}_unknown_has_amount`);
        };
        validatePrice(product.price, 'product_price');
        for (const [key, fact] of Object.entries(product.attributes || {})) validateFact(fact, `attribute_${key}`);
        if (!Array.isArray(product.variants)) issues.push('variants_invalid');
        for (const variant of product.variants || []) {
            if (!variant.option || !variant.value) issues.push('variant_identity_invalid');
            validatePrice(variant.price, 'variant_price');
            validateFact(variant.availability, 'variant_availability');
            if (variant.image?.state === 'AVAILABLE' && !isTenantOwnedMediaUrl(variant.image.url, product.shopId)) issues.push('variant_image_invalid');
            if (!['AVAILABLE', 'UNKNOWN'].includes(variant.image?.state)) issues.push('variant_image_state_invalid');
            if (variant.image?.state === 'UNKNOWN' && variant.image.url !== null) issues.push('variant_image_unknown_has_url');
        }
        if (product.selectedVariant) {
            const selected = (product.variants || []).find(variant => String(variant.id) === String(product.selectedVariant.id));
            if (!selected || selected.value !== product.selectedVariant.value || selected.option !== product.selectedVariant.option) {
                issues.push('selected_variant_invalid');
            }
        }
        if (!product.image || !['AVAILABLE', 'UNKNOWN'].includes(product.image.state)) issues.push('product_image_state_invalid');
        if (product.image.state === 'AVAILABLE' && !isTenantOwnedMediaUrl(product.image.url, product.shopId)) issues.push('product_image_invalid');
        if (product.image.state === 'UNKNOWN' && product.image.url !== null) issues.push('product_image_unknown_has_url');
        if (!product.detailLink || product.detailLink.state !== 'UNKNOWN' || product.detailLink.url !== null) issues.push('detail_link_unverified');
    }
    if (!presentation?.media || !['AVAILABLE', 'NOT_REQUESTED', 'UNAVAILABLE', 'AMBIGUOUS', 'NO_PRODUCT'].includes(presentation.media.state)) {
        issues.push('media_state_invalid');
    }
    if (presentation?.media?.state === 'AVAILABLE') {
        const owner = products.find(product => String(product.id) === String(presentation.media.productId));
        if (!owner || owner.image.state !== 'AVAILABLE' || owner.image.url !== presentation.media.url) issues.push('media_owner_mismatch');
    }
    if (!presentation?.detailLink || presentation.detailLink.state !== 'UNKNOWN' || presentation.detailLink.url !== null) issues.push('detail_link_unverified');
    return [...new Set(issues)];
};

const safeLabel = (value) => String(value || '')
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 160);

const formatPrice = (price) => {
    if (price?.state !== 'KNOWN') return null;
    const formatted = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(price.amount);
    return `৳${formatted}`;
};

const renderMessengerProductPresentation = (presentation, language = 'mixed') => {
    if (validateProductPresentation(presentation).length || presentation.status !== 'READY') {
        return { text: null, attachments: [] };
    }
    const normalizedLanguage = normalizeLanguage(language);
    const lines = presentation.products.map(product => {
        const title = safeLabel(normalizedLanguage === 'bn' ? product.titleBn || product.title : product.title);
        const price = formatPrice(product.price);
        const variants = product.selectedVariant
            ? product.variants.filter(variant => String(variant.id) === String(product.selectedVariant.id))
            : product.variants;
        const availableVariants = variants
            .filter(variant => variant.availability.state === 'KNOWN' && variant.availability.value === 'IN_STOCK')
            .map(variant => {
                const option = safeLabel(variant.option);
                const value = safeLabel(variant.value);
                const variantPrice = variant.price.state === 'KNOWN' ? formatPrice(variant.price) : null;
                return `${option} ${value}${variantPrice ? ` (${variantPrice})` : ''}`.trim();
            })
            .filter(Boolean);
        const selectedUnavailable = product.selectedVariant && variants.some(variant =>
            variant.availability.state === 'KNOWN' && variant.availability.value === 'OUT_OF_STOCK');
        const selectedAvailable = product.selectedVariant && variants.some(variant =>
            variant.availability.state === 'KNOWN' && variant.availability.value === 'IN_STOCK');
        const optionsLabel = normalizedLanguage === 'bn' ? 'উপলভ্য অপশন:' : 'Available options:';
        const unavailable = normalizedLanguage === 'bn' ? 'এই অপশনটি এখন স্টকে নেই।' : 'This option is currently out of stock.';
        const available = normalizedLanguage === 'bn' ? 'এই অপশনটি স্টকে আছে।' : 'This option is in stock.';
        return [
            `${title}${product.selectedVariant ? ` — ${safeLabel(product.selectedVariant.option)} ${safeLabel(product.selectedVariant.value)}` : ''}${price ? ` — ${price}` : ''}`,
            ...(selectedAvailable ? [available] : []),
            ...(selectedUnavailable ? [unavailable] : []),
            ...(!product.selectedVariant && availableVariants.length ? [`${optionsLabel} ${availableVariants.join(', ')}`] : []),
        ].join('\n');
    });
    const prompt = normalizedLanguage === 'bn'
        ? 'কোন পণ্যটি চান একটু জানাবেন?'
        : normalizedLanguage === 'en'
            ? 'Which one do you mean?'
            : 'Kon product ta bujhiye bolben?';
    const text = presentation.selection === 'MULTIPLE'
        ? `${lines.join('\n\n')}\n\n${prompt}`
        : lines[0];
    const only = presentation.products.length === 1 ? presentation.products[0] : null;
    const attachments = only
        && presentation.media.state === 'AVAILABLE'
        && presentation.media.productId === only.id
        && presentation.media.url === only.image.url
        ? [{ type: 'image', url: only.image.url, productId: only.id }]
        : [];
    return { text, attachments };
};

module.exports = {
    SCHEMA_VERSION,
    DEFAULT_CURRENCY,
    buildProductPresentation,
    renderMessengerProductPresentation,
    validateProductPresentation,
};
