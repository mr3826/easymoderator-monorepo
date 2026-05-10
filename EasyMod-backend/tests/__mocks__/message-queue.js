'use strict';

// Global test stub — prevents BullMQ from opening a real Redis connection.
// Any module that requires message-queue during tests gets this stub instead.
module.exports = {
    messageQueue: {
        add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
    },
    connection: { host: 'localhost', port: 6379 },
};
