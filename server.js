require('module-alias/register');
const config = require('src/config/config');

// Allow self-signed certificates for development
if (config.env === 'development') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const app = require('src/app');
const { sequelize } = require('src/utils/database/database-setup');

const startServer = async () => {
    try {
        // Database Connection
        await sequelize.authenticate();
        console.log('Database connection established successfully.');

        // Sync models (disable in production or use migrations)
        if (config.env === 'development') {
            await sequelize.sync({ force: false });
        } 

        app.listen(config.port, '0.0.0.0', () => {
            console.log(`Server running on port ${config.port}`);
        });
    } catch (error) {
        console.error('Unable to connect to the database:', error);
        process.exit(1);
    }
};

startServer();
