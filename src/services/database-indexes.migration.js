/**
 * Database Indexes Migration - Task 1
 * Creates composite indexes on products table for optimized shop_id queries
 * 
 * Supports rollback with transaction safety
 * @module services/database-indexes.migration
 */

const logger = require('../utils/structured-logger');

class DatabaseIndexMigration {
  constructor(dbConnection) {
    this.db = dbConnection;
    this.indexName = 'database_indexes_migration_phase4';
  }

  /**
   * Define composite indexes to create
   * @returns {Array<Object>} Index definitions
   */
  getIndexDefinitions() {
    return [
      {
        name: 'idx_products_shop_category_active',
        table: 'products',
        columns: ['shop_id', 'category', 'is_active'],
        where: 'is_active = true',
        description: 'Fast lookup: active products by shop & category'
      },
      {
        name: 'idx_products_shop_sku_status',
        table: 'products',
        columns: ['shop_id', 'sku', 'status'],
        where: 'status IN (\'active\', \'discontinued\')',
        description: 'Fast lookup: products by SKU & status within shop'
      },
      {
        name: 'idx_products_shop_created_inventory',
        table: 'products',
        columns: ['shop_id', 'created_at DESC', 'inventory_level'],
        description: 'Time-based inventory queries for shop'
      },
      {
        name: 'idx_products_shop_price_range',
        table: 'products',
        columns: ['shop_id', 'price_min', 'price_max'],
        description: 'Price range filtering within shop'
      }
    ];
  }

  /**
   * UP: Create all indexes
   * @async
   * @returns {Promise<Object>} Migration result
   */
  async up() {
    const context = { migration: 'up', timestamp: new Date().toISOString() };
    logger.info('Starting database migration (up)', context);

    const client = await this.db.getConnection();
    let transaction;

    try {
      transaction = await client.query('BEGIN');
      const results = [];
      const definitions = this.getIndexDefinitions();

      for (const indexDef of definitions) {
        try {
          const { name, table, columns, where, description } = indexDef;
          const columnStr = columns.join(', ');
          const whereClause = where ? ` WHERE ${where}` : '';

          const query = `CREATE INDEX CONCURRENTLY ${name} ON ${table} (${columnStr})${whereClause};`;
          
          const result = await client.query(query);
          
          results.push({
            index: name,
            status: 'created',
            columns,
            description
          });

          logger.info(`Index created: ${name}`, {
            ...context,
            index: name,
            columns
          });

        } catch (indexError) {
          // Index might already exist - check if it's an idempotent error
          if (indexError.message.includes('already exists')) {
            results.push({
              index: indexDef.name,
              status: 'skipped',
              reason: 'already exists'
            });
            logger.warn(`Index already exists: ${indexDef.name}`, context);
          } else {
            throw indexError;
          }
        }
      }

      await client.query('COMMIT');
      
      logger.info('Migration completed successfully', {
        ...context,
        indexesCreated: results.filter(r => r.status === 'created').length,
        indexesSkipped: results.filter(r => r.status === 'skipped').length
      });

      return {
        success: true,
        direction: 'up',
        results,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      if (transaction) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error('Rollback failed', {
            ...context,
            error: rollbackError.message
          });
        }
      }

      logger.error('Migration failed during UP', {
        ...context,
        error: error.message,
        stack: error.stack
      });

      throw {
        code: 'MIGRATION_FAILED',
        direction: 'up',
        message: error.message,
        timestamp: new Date().toISOString()
      };

    } finally {
      if (client) {
        await client.release();
      }
    }
  }

  /**
   * DOWN: Drop all indexes
   * @async
   * @returns {Promise<Object>} Migration result
   */
  async down() {
    const context = { migration: 'down', timestamp: new Date().toISOString() };
    logger.info('Starting database migration (down)', context);

    const client = await this.db.getConnection();
    let transaction;

    try {
      transaction = await client.query('BEGIN');
      const results = [];
      const definitions = this.getIndexDefinitions();

      for (const indexDef of definitions) {
        try {
          const { name } = indexDef;
          
          // Use DROP INDEX CONCURRENTLY to avoid locks
          const query = `DROP INDEX IF EXISTS CONCURRENTLY ${name};`;
          
          await client.query(query);
          
          results.push({
            index: name,
            status: 'dropped'
          });

          logger.info(`Index dropped: ${name}`, {
            ...context,
            index: name
          });

        } catch (indexError) {
          logger.warn(`Failed to drop index: ${indexDef.name}`, {
            ...context,
            error: indexError.message
          });
          
          results.push({
            index: indexDef.name,
            status: 'failed',
            reason: indexError.message
          });
        }
      }

      await client.query('COMMIT');

      logger.info('Migration completed successfully (down)', {
        ...context,
        indexesDropped: results.filter(r => r.status === 'dropped').length
      });

      return {
        success: true,
        direction: 'down',
        results,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      if (transaction) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error('Rollback failed', {
            ...context,
            error: rollbackError.message
          });
        }
      }

      logger.error('Migration failed during DOWN', {
        ...context,
        error: error.message
      });

      throw {
        code: 'MIGRATION_FAILED',
        direction: 'down',
        message: error.message,
        timestamp: new Date().toISOString()
      };

    } finally {
      if (client) {
        await client.release();
      }
    }
  }

  /**
   * Verify all indexes exist and are valid
   * @async
   * @returns {Promise<Object>} Verification report
   */
  async verify() {
    const context = { operation: 'verify', timestamp: new Date().toISOString() };
    logger.info('Verifying database indexes', context);

    const client = await this.db.getConnection();

    try {
      const definitions = this.getIndexDefinitions();
      const verification = {
        timestamp: new Date().toISOString(),
        indexes: [],
        allValid: true
      };

      for (const indexDef of definitions) {
        const query = `
          SELECT 
            schemaname,
            indexname,
            tablename,
            indexdef
          FROM pg_indexes
          WHERE indexname = $1
        `;

        const result = await client.query(query, [indexDef.name]);

        if (result.rows.length > 0) {
          const indexInfo = result.rows[0];
          
          // Check index size
          const sizeQuery = `
            SELECT pg_size_pretty(pg_relation_size($1::regclass)) as size
          `;
          const sizeResult = await client.query(sizeQuery, [indexDef.name]);

          verification.indexes.push({
            name: indexDef.name,
            status: 'exists',
            table: indexInfo.tablename,
            size: sizeResult.rows[0].size,
            definition: indexInfo.indexdef
          });

          logger.info(`Index verified: ${indexDef.name}`, {
            ...context,
            index: indexDef.name,
            status: 'valid'
          });

        } else {
          verification.indexes.push({
            name: indexDef.name,
            status: 'missing',
            table: indexDef.table
          });

          verification.allValid = false;

          logger.warn(`Index missing: ${indexDef.name}`, {
            ...context,
            index: indexDef.name
          });
        }
      }

      return verification;

    } catch (error) {
      logger.error('Verification failed', {
        ...context,
        error: error.message
      });

      throw {
        code: 'VERIFICATION_FAILED',
        message: error.message,
        timestamp: new Date().toISOString()
      };

    } finally {
      if (client) {
        await client.release();
      }
    }
  }

  /**
   * Get index statistics for performance monitoring
   * @async
   * @returns {Promise<Array>} Index statistics
   */
  async getStatistics() {
    const client = await this.db.getConnection();

    try {
      const query = `
        SELECT
          schemaname,
          tablename,
          indexname,
          idx_scan as scans,
          idx_tup_read as tuples_read,
          idx_tup_fetch as tuples_fetched,
          pg_size_pretty(pg_relation_size(indexrelid)) as size
        FROM pg_stat_user_indexes
        WHERE tablename = 'products'
        AND indexname LIKE 'idx_products_%'
        ORDER BY idx_scan DESC
      `;

      const result = await client.query(query);

      logger.info('Index statistics retrieved', {
        operation: 'getStatistics',
        indexCount: result.rows.length
      });

      return result.rows;

    } finally {
      if (client) {
        await client.release();
      }
    }
  }
}

module.exports = DatabaseIndexMigration;
