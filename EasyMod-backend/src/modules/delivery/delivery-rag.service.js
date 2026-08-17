const { v4: uuidv4 } = require('uuid');
const {
    EMBEDDING_SPACE_MANIFEST_FIELD,
    EMBEDDING_SPACE_MANIFEST_POINT_ID,
    createEmbeddingSpaceIdentity,
    createManifestPayload,
    createManifestVector,
    identityFromPayload,
    identityToPayload,
    sameEmbeddingSpace,
} = require('../rag/embedding-space');
let QdrantClient = null;
try {
    ({ QdrantClient } = require('@qdrant/qdrant-js'));
} catch (_) {
    QdrantClient = null;
}

class DeliveryRAGService {
    constructor() {
        this.provider = process.env.DELIVERY_VECTOR_PROVIDER || 'qdrant';

        if (this.provider !== 'qdrant') {
            throw new Error('DeliveryRAG currently supports qdrant provider only. Set DELIVERY_VECTOR_PROVIDER=qdrant.');
        }

        if (!QdrantClient) {
            throw new Error('Missing @qdrant/qdrant-js dependency for DeliveryRAGService');
        }

        // Initialize Qdrant client
        this.client = new QdrantClient({
            url: process.env.QDRANT_URL || 'http://localhost:6333',
            api_key: process.env.QDRANT_API_KEY || null
        });
        
        this.collectionName = 'delivery_zones';
        this.addressCollectionName = 'delivery_addresses';
        this.embeddingIdentity = createEmbeddingSpaceIdentity({
            provider: 'local',
            model: 'delivery-zone-hash',
            version: 'delivery-zone-hash-v1',
            dimensions: 384,
        });
    }

    contentFilter(filter = null) {
        const manifestCondition = {
            key: EMBEDDING_SPACE_MANIFEST_FIELD,
            match: { value: true },
        };
        return {
            ...(filter || {}),
            must_not: [
                ...((filter && Array.isArray(filter.must_not)) ? filter.must_not : []),
                manifestCondition,
            ],
        };
    }

    async readCollectionBinding(collection) {
        const info = await this.client.getCollection(collection);
        const scrollResult = await this.client.scroll(collection, {
            filter: {
                must: [{ key: EMBEDDING_SPACE_MANIFEST_FIELD, match: { value: true } }],
            },
            limit: 1,
            with_payload: true,
            with_vector: false,
        });
        const manifest = scrollResult?.result?.points?.[0];
        const identity = identityFromPayload(manifest?.payload);
        const vectors = info?.result?.config?.params?.vectors || info?.config?.params?.vectors;
        const size = vectors?.size || vectors?.default?.size
            || Object.values(vectors || {}).find((value) => Number.isInteger(value?.size))?.size;
        if (!identity || manifest?.payload?.embedding_collection !== collection
            || Number(size) !== this.embeddingIdentity.dimensions
            || !sameEmbeddingSpace(identity, this.embeddingIdentity)) {
            const error = new Error(`delivery collection has no trusted local embedding binding: ${collection}`);
            error.code = 'EMBEDDING_COLLECTION_IDENTITY_UNKNOWN';
            throw error;
        }
        return { collection, identity, state: manifest.payload.embedding_collection_state };
    }

    async ensureBoundCollection(collection) {
        let exists = true;
        try {
            await this.client.getCollection(collection);
        } catch (error) {
            const message = String(error?.message || error || '');
            if (error?.status !== 404 && !/not.?found|does not exist/i.test(message)) throw error;
            exists = false;
        }

        if (!exists) {
            await this.client.createCollection(collection, {
                vectors: {
                    size: this.embeddingIdentity.dimensions,
                    distance: 'Cosine',
                },
                optimizers_config: { default_segment_number: 2 },
            });
            await this.client.upsert(collection, {
                wait: true,
                points: [{
                    id: EMBEDDING_SPACE_MANIFEST_POINT_ID,
                    vector: createManifestVector(this.embeddingIdentity.dimensions),
                    payload: createManifestPayload({
                        collection,
                        identity: this.embeddingIdentity,
                        state: 'ACTIVE',
                    }),
                }],
            });
        }

        return this.readCollectionBinding(collection);
    }

    assertBoundVector(binding, vector) {
        if (!Array.isArray(vector) || vector.length !== this.embeddingIdentity.dimensions) {
            throw new Error('delivery embedding vector dimension mismatch');
        }
        if (!sameEmbeddingSpace(binding.identity, this.embeddingIdentity)) {
            const error = new Error('delivery query/document embedding space mismatch');
            error.code = 'EMBEDDING_SPACE_MISMATCH';
            throw error;
        }
    }

    /**
     * Initialize delivery collections in Qdrant
     */
    async initializeCollections() {
        try {
            await this.ensureBoundCollection(this.collectionName);
            await this.ensureBoundCollection(this.addressCollectionName);

            console.log('✅ Delivery RAG collections initialized');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize collections:', error);
            return false;
        }
    }

    /**
     * Add delivery zone with embedding
     */
    async addDeliveryZone(zoneData) {
        const {
            zone_name,
            areas, // Array of area names
            delivery_charge,
            estimated_time,
            shop_id,
            metadata = {}
        } = zoneData;

        try {
            const binding = await this.ensureBoundCollection(this.collectionName);
            // Generate embeddings for all areas in this zone
            const embeddings = await this.generateEmbeddings(areas);
            embeddings.forEach((vector) => this.assertBoundVector(binding, vector));

            const points = areas.map((area, index) => ({
                id: uuidv4(),
                vector: embeddings[index],
                payload: {
                    zone_name,
                    area_name: area,
                    delivery_charge,
                    estimated_time,
                    shop_id,
                    metadata,
                    ...identityToPayload(this.embeddingIdentity),
                    [EMBEDDING_SPACE_MANIFEST_FIELD]: false,
                }
            }));

            await this.client.upsert(this.collectionName, {
                wait: true,
                points
            });

            console.log(`✅ Added delivery zone "${zone_name}" with ${areas.length} areas`);
            return { success: true, zone_name, areas_count: areas.length };

        } catch (error) {
            console.error('❌ Failed to add delivery zone:', error);
            throw new Error(`Failed to add delivery zone: ${error.message}`);
        }
    }

    /**
     * Match address to delivery zone
     */
    async matchAddressToZone(address, shop_id) {
        try {
            const binding = await this.ensureBoundCollection(this.collectionName);
            // Generate embedding for the input address
            const addressEmbedding = await this.generateEmbeddings([address]);
            this.assertBoundVector(binding, addressEmbedding[0]);

            // Search for matching zones
            const searchResult = await this.client.search(this.collectionName, {
                vector: addressEmbedding[0],
                limit: 5,
                score_threshold: 0.7,
                filter: this.contentFilter({
                    must: [
                        {
                            key: 'shop_id',
                            match: { value: shop_id }
                        }
                    ]
                })
            });

            if (searchResult.length === 0) {
                return {
                    success: false,
                    message: 'No delivery zone found for this address',
                    delivery_charge: null,
                    estimated_time: null,
                    zone_name: null
                };
            }

            // Get the best match
            const bestMatch = searchResult[0];
            const payload = bestMatch.payload;

            return {
                success: true,
                zone_name: payload.zone_name,
                matched_area: payload.area_name,
                delivery_charge: payload.delivery_charge,
                estimated_time: payload.estimated_time,
                confidence: bestMatch.score,
                metadata: payload.metadata
            };

        } catch (error) {
            console.error('❌ Failed to match address to zone:', error);
            throw new Error(`Failed to match address: ${error.message}`);
        }
    }

    /**
     * Get all delivery zones for a shop
     */
    async getDeliveryZones(shop_id) {
        try {
            await this.ensureBoundCollection(this.collectionName);
            const scrollResult = await this.client.scroll(this.collectionName, {
                filter: this.contentFilter({
                    must: [
                        {
                            key: 'shop_id',
                            match: { value: shop_id }
                        }
                    ]
                }),
                limit: 1000,
                with_payload: true,
                with_vector: false
            });

            // Group by zone_name
            const zones = {};
            scrollResult.result.points.forEach(point => {
                const payload = point.payload;
                if (!zones[payload.zone_name]) {
                    zones[payload.zone_name] = {
                        zone_name: payload.zone_name,
                        delivery_charge: payload.delivery_charge,
                        estimated_time: payload.estimated_time,
                        areas: [],
                        metadata: payload.metadata
                    };
                }
                zones[payload.zone_name].areas.push(payload.area_name);
            });

            return Object.values(zones);

        } catch (error) {
            console.error('❌ Failed to get delivery zones:', error);
            throw new Error(`Failed to get delivery zones: ${error.message}`);
        }
    }

    /**
     * Update delivery zone
     */
    async updateDeliveryZone(zone_name, shop_id, updateData) {
        try {
            await this.ensureBoundCollection(this.collectionName);
            // First, find all points for this zone
            const scrollResult = await this.client.scroll(this.collectionName, {
                filter: this.contentFilter({
                    must: [
                        {
                            key: 'shop_id',
                            match: { value: shop_id }
                        },
                        {
                            key: 'zone_name',
                            match: { value: zone_name }
                        }
                    ]
                }),
                limit: 1000,
                with_payload: true
            });

            if (scrollResult.result.points.length === 0) {
                throw new Error(`Delivery zone "${zone_name}" not found`);
            }

            // Update each point
            const pointIds = scrollResult.result.points.map(point => point.id);
            
            await this.client.overwritePayload(this.collectionName, {
                payload: {
                    ...updateData,
                    ...identityToPayload(this.embeddingIdentity),
                    [EMBEDDING_SPACE_MANIFEST_FIELD]: false,
                },
                points: pointIds
            });

            console.log(`✅ Updated delivery zone "${zone_name}"`);
            return { success: true, zone_name, updated_points: pointIds.length };

        } catch (error) {
            console.error('❌ Failed to update delivery zone:', error);
            throw new Error(`Failed to update delivery zone: ${error.message}`);
        }
    }

    /**
     * Delete delivery zone
     */
    async deleteDeliveryZone(zone_name, shop_id) {
        try {
            await this.ensureBoundCollection(this.collectionName);
            const scrollResult = await this.client.scroll(this.collectionName, {
                filter: this.contentFilter({
                    must: [
                        {
                            key: 'shop_id',
                            match: { value: shop_id }
                        },
                        {
                            key: 'zone_name',
                            match: { value: zone_name }
                        }
                    ]
                }),
                limit: 1000,
                with_payload: false
            });

            if (scrollResult.result.points.length === 0) {
                throw new Error(`Delivery zone "${zone_name}" not found`);
            }

            const pointIds = scrollResult.result.points.map(point => point.id);
            
            await this.client.delete(this.collectionName, {
                points: pointIds
            });

            console.log(`✅ Deleted delivery zone "${zone_name}"`);
            return { success: true, zone_name, deleted_points: pointIds.length };

        } catch (error) {
            console.error('❌ Failed to delete delivery zone:', error);
            throw new Error(`Failed to delete delivery zone: ${error.message}`);
        }
    }

    /**
     * Generate embeddings for text
     */
    async generateEmbeddings(texts) {
        // For now, use a simple embedding approach
        // In production, this would use a proper embedding model like sentence-transformers
        return texts.map(text => this.simpleEmbedding(text));
    }

    /**
     * Simple embedding function (placeholder)
     * In production, replace with proper embedding model
     */
    simpleEmbedding(text) {
        // Create a simple hash-based embedding
        const normalizedText = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const words = normalizedText.split(/\s+/).filter(w => w.length > 0);
        
        // Create 384-dimensional vector
        const embedding = new Array(384).fill(0);
        
        words.forEach((word, index) => {
            for (let i = 0; i < word.length; i++) {
                const charCode = word.charCodeAt(i);
                const pos = (index * 10 + i * 3) % 384;
                embedding[pos] = (embedding[pos] + charCode) / 1000;
            }
        });
        
        // Normalize the vector
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return embedding.map(val => magnitude > 0 ? val / magnitude : 0);
    }

    /**
     * Calculate delivery charge based on zone and order value
     */
    async calculateDeliveryCharge(zone_name, order_value, shop_id) {
        try {
            await this.ensureBoundCollection(this.collectionName);
            // Get zone info
            const scrollResult = await this.client.scroll(this.collectionName, {
                filter: this.contentFilter({
                    must: [
                        {
                            key: 'shop_id',
                            match: { value: shop_id }
                        },
                        {
                            key: 'zone_name',
                            match: { value: zone_name }
                        }
                    ]
                }),
                limit: 1,
                with_payload: true
            });

            if (scrollResult.result.points.length === 0) {
                throw new Error(`Delivery zone "${zone_name}" not found`);
            }

            const zone = scrollResult.result.points[0].payload;
            let deliveryCharge = zone.delivery_charge;

            // Apply free delivery logic if order value is high
            if (zone.metadata?.free_delivery_threshold && order_value >= zone.metadata.free_delivery_threshold) {
                deliveryCharge = 0;
            }

            // Apply tiered pricing if configured
            if (zone.metadata?.tiered_pricing) {
                const tiers = zone.metadata.tiered_pricing;
                for (const tier of tiers) {
                    if (order_value >= tier.min_order_value) {
                        deliveryCharge = tier.delivery_charge;
                        break;
                    }
                }
            }

            return {
                base_charge: zone.delivery_charge,
                final_charge: deliveryCharge,
                free_delivery_applied: deliveryCharge === 0 && zone.delivery_charge > 0,
                zone_name: zone_name
            };

        } catch (error) {
            console.error('❌ Failed to calculate delivery charge:', error);
            throw new Error(`Failed to calculate delivery charge: ${error.message}`);
        }
    }

    /**
     * Get delivery statistics for a shop
     */
    async getDeliveryStats(shop_id) {
        try {
            await this.ensureBoundCollection(this.collectionName);
            const scrollResult = await this.client.scroll(this.collectionName, {
                filter: this.contentFilter({
                    must: [
                        {
                            key: 'shop_id',
                            match: { value: shop_id }
                        }
                    ]
                }),
                limit: 1000,
                with_payload: true
            });

            const zones = {};
            let totalAreas = 0;
            let totalCharges = 0;

            scrollResult.result.points.forEach(point => {
                const payload = point.payload;
                if (!zones[payload.zone_name]) {
                    zones[payload.zone_name] = {
                        zone_name: payload.zone_name,
                        delivery_charge: payload.delivery_charge,
                        estimated_time: payload.estimated_time,
                        areas: []
                    };
                    totalCharges += payload.delivery_charge;
                }
                zones[payload.zone_name].areas.push(payload.area_name);
                totalAreas++;
            });

            return {
                total_zones: Object.keys(zones).length,
                total_areas: totalAreas,
                average_delivery_charge: Object.keys(zones).length > 0 ? totalCharges / Object.keys(zones).length : 0,
                zones: Object.values(zones)
            };

        } catch (error) {
            console.error('❌ Failed to get delivery stats:', error);
            throw new Error(`Failed to get delivery stats: ${error.message}`);
        }
    }
}

module.exports = DeliveryRAGService;
