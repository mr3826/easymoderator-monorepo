const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const KnownArea = sequelize.define('KnownArea', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'shops',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    area_name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    area_name_bn: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    zone_type: {
        type: DataTypes.ENUM('inside_city', 'outside_city', 'suburban'),
        allowNull: false
    }
}, {
    tableName: 'known_areas',
    underscored: true,
    timestamps: true,
    updatedAt: false
});

module.exports = KnownArea;
