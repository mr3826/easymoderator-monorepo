module.exports = {
  name: '20260209_001_add_customer_email',
  up: async (sequelize) => {
    const { DataTypes } = require('sequelize');
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('customers', 'email', {
      type: DataTypes.STRING,
      allowNull: true
    }).catch(() => {});
  },
  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.removeColumn('customers', 'email').catch(() => {});
  }
};
