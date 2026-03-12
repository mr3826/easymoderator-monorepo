const { body, validationResult } = require('express-validator');
const DeliveryRAGService = require('./delivery-rag.service');

class DeliveryRAGController {
    /**
     * Initialize delivery RAG collections
     */
    static async initializeCollections(req, res) {
        try {
            const deliveryService = new DeliveryRAGService();
            const result = await deliveryService.initializeCollections();
            
            res.json({
                success: true,
                message: 'Delivery RAG collections initialized successfully',
                initialized: result
            });

        } catch (error) {
            console.error('Initialize collections error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to initialize delivery RAG collections'
            });
        }
    }

    /**
     * Add new delivery zone
     */
    static async addDeliveryZone(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const {
                shop_id,
                zone_name,
                areas,
                delivery_charge,
                estimated_time,
                metadata = {}
            } = req.body;

            const deliveryService = new DeliveryRAGService();
            const result = await deliveryService.addDeliveryZone({
                zone_name,
                areas,
                delivery_charge,
                estimated_time,
                shop_id,
                metadata
            });

            res.json({
                success: true,
                data: result,
                message: `Delivery zone "${zone_name}" added successfully`
            });

        } catch (error) {
            console.error('Add delivery zone error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Match address to delivery zone
     */
    static async matchAddress(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { shop_id, address } = req.body;

            const deliveryService = new DeliveryRAGService();
            const result = await deliveryService.matchAddressToZone(address, shop_id);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            console.error('Match address error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get all delivery zones for a shop
     */
    static async getDeliveryZones(req, res) {
        try {
            const { shop_id } = req.query;

            if (!shop_id) {
                return res.status(400).json({
                    success: false,
                    error: 'shop_id is required'
                });
            }

            const deliveryService = new DeliveryRAGService();
            const zones = await deliveryService.getDeliveryZones(shop_id);

            res.json({
                success: true,
                data: zones,
                count: zones.length
            });

        } catch (error) {
            console.error('Get delivery zones error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Update delivery zone
     */
    static async updateDeliveryZone(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { shop_id, zone_name } = req.params;
            const updateData = req.body;

            const deliveryService = new DeliveryRAGService();
            const result = await deliveryService.updateDeliveryZone(zone_name, shop_id, updateData);

            res.json({
                success: true,
                data: result,
                message: `Delivery zone "${zone_name}" updated successfully`
            });

        } catch (error) {
            console.error('Update delivery zone error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Delete delivery zone
     */
    static async deleteDeliveryZone(req, res) {
        try {
            const { shop_id, zone_name } = req.params;

            const deliveryService = new DeliveryRAGService();
            const result = await deliveryService.deleteDeliveryZone(zone_name, shop_id);

            res.json({
                success: true,
                data: result,
                message: `Delivery zone "${zone_name}" deleted successfully`
            });

        } catch (error) {
            console.error('Delete delivery zone error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Calculate delivery charge
     */
    static async calculateDeliveryCharge(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { shop_id, zone_name, order_value } = req.body;

            const deliveryService = new DeliveryRAGService();
            const result = await deliveryService.calculateDeliveryCharge(zone_name, order_value, shop_id);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            console.error('Calculate delivery charge error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get delivery statistics
     */
    static async getDeliveryStats(req, res) {
        try {
            const { shop_id } = req.query;

            if (!shop_id) {
                return res.status(400).json({
                    success: false,
                    error: 'shop_id is required'
                });
            }

            const deliveryService = new DeliveryRAGService();
            const stats = await deliveryService.getDeliveryStats(shop_id);

            res.json({
                success: true,
                data: stats
            });

        } catch (error) {
            console.error('Get delivery stats error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Batch add delivery zones
     */
    static async batchAddDeliveryZones(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { shop_id, zones } = req.body;

            const deliveryService = new DeliveryRAGService();
            const results = [];

            for (const zone of zones) {
                try {
                    const result = await deliveryService.addDeliveryZone({
                        ...zone,
                        shop_id
                    });
                    results.push({
                        zone_name: zone.zone_name,
                        success: true,
                        data: result
                    });
                } catch (error) {
                    results.push({
                        zone_name: zone.zone_name,
                        success: false,
                        error: error.message
                    });
                }
            }

            const successCount = results.filter(r => r.success).length;
            const failureCount = results.length - successCount;

            res.json({
                success: true,
                data: {
                    total_zones: zones.length,
                    successful: successCount,
                    failed: failureCount,
                    results
                },
                message: `Batch operation completed: ${successCount} successful, ${failureCount} failed`
            });

        } catch (error) {
            console.error('Batch add delivery zones error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Test address matching with sample data
     */
    static async testAddressMatching(req, res) {
        try {
            const { shop_id } = req.query;

            if (!shop_id) {
                return res.status(400).json({
                    success: false,
                    error: 'shop_id is required'
                });
            }

            const deliveryService = new DeliveryRAGService();
            
            // Sample addresses for testing
            const testAddresses = [
                'Dhanmondi, Dhaka',
                'Gulshan 1, Dhaka',
                'Mirpur 10, Dhaka',
                'Banani, Dhaka',
                'Uttara, Dhaka',
                'Mohammadpur, Dhaka'
            ];

            const results = [];
            for (const address of testAddresses) {
                try {
                    const match = await deliveryService.matchAddressToZone(address, shop_id);
                    results.push({
                        address,
                        success: match.success,
                        zone_name: match.zone_name,
                        delivery_charge: match.delivery_charge,
                        confidence: match.confidence
                    });
                } catch (error) {
                    results.push({
                        address,
                        success: false,
                        error: error.message
                    });
                }
            }

            res.json({
                success: true,
                data: {
                    test_addresses: results,
                    shop_id
                }
            });

        } catch (error) {
            console.error('Test address matching error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = DeliveryRAGController;
