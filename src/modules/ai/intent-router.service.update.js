// src/modules/ai/intent-router.service.update.js
// TASK 6: Intent Router - Reorder Hierarchy for Better Performance
// Purpose: Reorder intent routing to put fastest (most accurate) routes first
// Owner: Backend Dev
// Effort: 0.75 days
// Deadline: End of Day 5

/**
 * CURRENT HIERARCHY (v1):
 * 1. Cache (exact match) - <50ms      [FAST]
 * 2. Semantic (FAQ search) - <100ms  [MEDIUM]
 * 3. LLM (LLM call) - 1500-4000ms    [SLOW]
 * 
 * PROPOSED HIERARCHY CHANGE (v2):
 * 1. Cache (exact match) - <50ms                              [FAST]
 * 2. SQL Product Match (pre-check products) - <200ms         [FAST] ← NEW
 * 3. Semantic FAQ (if no exact product) - <100ms             [MEDIUM]
 * 4. LLM (only if above fail) - 1500-4000ms                  [SLOW]
 * 
 * WHY: Most product queries are resolvable by exact product lookup.
 *      Doing this BEFORE semantic search saves 100ms per query.
 *      Expected: Reduce LLM calls by 15-20%, reduce latency by 10%.
 * 
 * ASSUMPTION: Products table has indexed shop_id + name/sku for <200ms lookup
 *             (This is deployed in TASK 1: 20260326_001_add_product_indexes.js)
 */

class IntentRouterServiceUpdate {
  /**
   * MAIN METHOD: Route message to fastest appropriate handler
   * 
   * @param message - Customer message
   * @param conversationContext - Chat history
   * @param shopId - Shop ID
   * @returns { route, response, latency, routePath }
   */
  async routeMessage(message, conversationContext, shopId) {
    const startTime = Date.now();
    const routePath = [];

    this.logger.info(`[ROUTE] Routing message for shop ${shopId}: "${message.substring(0, 50)}..."`);

    try {
      // ============================================================
      // TIER 1: EXACT MATCH CACHE (existing)
      // ============================================================
      routePath.push('CACHE');
      
      const cacheKey = this.hashMessage(message, shopId);
      const cachedResponse = await this.cache.get(cacheKey);

      if (cachedResponse) {
        const latency = Date.now() - startTime;
        this.logger.info(`[ROUTE] ✅ Cache hit (${latency}ms)`);

        return {
          route: 'CACHE',
          response: cachedResponse,
          latency,
          routePath,
          cached: true
        };
      }

      // ============================================================
      // TIER 2: SQL PRODUCT MATCH (NEW - v2 enhancement)
      // ============================================================
      routePath.push('SQL_PRODUCT_MATCH');
      this.logger.debug(`[ROUTE] Checking for product match...`);

      const productMatch = await this.matchProductFromMessage(message, shopId);

      if (productMatch.found) {
        // Customer is asking about a specific product
        const response = await this.formatProductResponse(
          productMatch.product,
          message,
          conversationContext
        );

        const latency = Date.now() - startTime;
        this.logger.info(
          `[ROUTE] ✅ SQL product match: "${productMatch.product.name}" (${latency}ms)`
        );

        // Cache this response for next time
        await this.cache.set(cacheKey, response, 300); // 5 min TTL

        return {
          route: 'SQL_PRODUCT_MATCH',
          response,
          latency,
          routePath,
          product: productMatch.product
        };
      }

      // ============================================================
      // TIER 3: SEMANTIC FAQ SEARCH (existing, same logic)
      // ============================================================
      routePath.push('SEMANTIC_FAQ');
      this.logger.debug(`[ROUTE] Searching FAQ index...`);

      const faqMatch = await this.semanticSearch.findSimilarFAQ(
        message,
        shopId,
        { threshold: 0.82 } // Only high-confidence matches
      );

      if (faqMatch && faqMatch.score > 0.82) {
        const response = faqMatch.answer;
        const latency = Date.now() - startTime;
        this.logger.info(
          `[ROUTE] ✅ Semantic FAQ match (${faqMatch.score.toFixed(2)} confidence, ${latency}ms)`
        );

        // Cache this
        await this.cache.set(cacheKey, response, 300);

        return {
          route: 'SEMANTIC_FAQ',
          response,
          latency,
          routePath,
          faqId: faqMatch.id,
          confidence: faqMatch.score
        };
      }

      // ============================================================
      // TIER 4: LLM CALL (fallback, same as before)
      // ============================================================
      routePath.push('LLM');
      this.logger.debug(`[ROUTE] No fast route matched, calling LLM...`);

      const llmResponse = await this.llmService.callLLMWithLatencyAwareFailover(
        message,
        conversationContext,
        shopId
      );

      const latency = Date.now() - startTime;
      this.logger.info(`[ROUTE] ✅ LLM call (${latency}ms)`);

      // Cache LLM response
      await this.cache.set(cacheKey, llmResponse, 300);

      return {
        route: 'LLM',
        response: llmResponse,
        latency,
        routePath,
        provider: llmResponse.provider
      };

    } catch (error) {
      this.logger.error(`[ROUTE] ❌ Routing failed: ${error.message}`);
      routePath.push('ERROR');

      throw new Error(`Message routing failed: ${error.message}`);
    }
  }

  /**
   * NEW METHOD: Match product from customer message
   * 
   * Uses SQL query (with indexes from TASK 1) to find matching product
   * 
   * Examples:
   *   "I want the iPhone 13" → Finds product with name LIKE "%iPhone 13%"
   *   "Do you have SKU ABC123?" → Finds product with sku = "ABC123"
   *   "What's the price of the red shirt?" → Finds product with category "shirt"
   * 
   * @param message - Customer message
   * @param shopId - Shop ID
   * @returns { found, product }
   */
  private async matchProductFromMessage(message, shopId) {
    this.logger.debug(`[SQL] Searching for product match in message: "${message}"`);

    try {
      // Extract potential product identifiers from message
      // This is a simplified version; production would use NER (Named Entity Recognition)
      const productNames = this.extractProductTerms(message);
      const skuMatch = this.extractSKU(message);

      if (skuMatch) {
        this.logger.debug(`[SQL] Found SKU pattern: ${skuMatch}`);

        // Query by SKU (should be <100ms with index)
        const product = await this.productRepository.findOne({
          where: {
            shop_id: shopId,
            sku: skuMatch
          }
        });

        if (product) {
          return { found: true, product };
        }
      }

      if (productNames.length > 0) {
        this.logger.debug(`[SQL] Found product terms: [${productNames.join(', ')}]`);

        // Query by name (should be <200ms with composite index on shop_id + name)
        for (const name of productNames) {
          const product = await this.productRepository.findOne({
            where: {
              shop_id: shopId,
              name: {
                [this.Op.like]: `%${name}%`
              }
            }
          });

          if (product) {
            this.logger.debug(`[SQL] Matched product: ${product.name}`);
            return { found: true, product };
          }
        }
      }

      this.logger.debug(`[SQL] No product match found`);
      return { found: false };

    } catch (error) {
      this.logger.warn(`[SQL] Product matching error (falling back to semantic): ${error.message}`);
      return { found: false };
    }
  }

  /**
   * NEW METHOD: Format response from product data
   * 
   * @param product - Product record
   * @param originalMessage - Original customer message
   * @param context - Chat history
   * @returns Response string
   */
  private async formatProductResponse(product, originalMessage, context) {
    // Simple template; production would use more sophisticated formatting
    const response = `
I found this product matching your query:

**${product.name}**
- Price: ${product.price} ${product.currency || 'BDT'}
- SKU: ${product.sku}
- Stock: ${product.stock_quantity > 0 ? `${product.stock_quantity} available` : 'Out of stock'}
- Category: ${product.category}

${product.description ? `\n${product.description}` : ''}

Would you like to know more or proceed with an order?`;

    return response;
  }

  /**
   * HELPER: Extract product terms from message
   * 
   * Simple regex-based extraction; production would use NER
   */
  private extractProductTerms(message) {
    // Look for common product patterns
    const terms = [];

    // Pattern: "the [adjective] [product]"
    const matches = message.match(/(?:the\s+)?(\w+(?:\s+\w+){0,2}?)(?:\s+(?:shirt|pants|phone|laptop|app|device|product))?/gi);
    
    if (matches) {
      terms.push(...matches.map(m => m.trim()).filter(m => m.length > 2));
    }

    return [...new Set(terms)].slice(0, 3); // Remove duplicates, limit to 3
  }

  /**
   * HELPER: Extract SKU from message
   */
  private extractSKU(message) {
    // Look for patterns like "SKU ABC123" or "code ABC123"
    const match = message.match(/(?:sku|code)\s+([A-Z0-9]+)/i);
    return match ? match[1] : null;
  }

  /**
   * HELPER: Hash message for cache key
   */
  private hashMessage(message, shopId) {
    const crypto = require('crypto');
    return `msg:${shopId}:${crypto.createHash('md5').update(message).digest('hex')}`;
  }
}

module.exports = IntentRouterServiceUpdate;

/**
 * PERFORMANCE COMPARISON: v1 vs v2
 * 
 * v1 (Current):
 *   Customer: "Do you have the iPhone 13 Pro?"
 *   Route: Cache miss → Semantic FAQ miss → LLM call
 *   Latency: 100ms + 1500-4000ms = 1600-4100ms
 *   Cost: $0.0015 per call
 * 
 * v2 (Proposed):
 *   Route: Cache miss → SQL product match (found!) → Return product info
 *   Latency: 100ms + 200ms = 300ms [~90% faster]
 *   Cost: $0 (no LLM call)
 * 
 * Expected Impact (based on 100 shops, 100K messages/month):
 *   - 15-20% of messages will hit SQL product match (currently going to LLM)
 *   - Saves: 1500-4000ms = ~3 million ms/month of latency
 *   - Saves: ~$150-200/month in LLM costs
 *   - Improves P95 latency: 5-8s → 2-3s (when combined with failover)
 * 
 * TESTING CHECKLIST:
 * [ ] Create 50 test products in dev shop
 * [ ] Load test with product queries: np runt test:load:products-in-messages
 * [ ] Verify <200ms latency for SQL matches
 * [ ] Verify fallback to semantic when no product match
 * [ ] Verify fallback to LLM when no product match
 * [ ] Check cache hit rate improvement
 * [ ] Verify no product false positives (wrong products matched)
 */
