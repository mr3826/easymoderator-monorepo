// Manual mock for `expo-secure-store` (auto-applied by Jest for all tests — this package wraps
// the Android Keystore, which has no Node/Jest equivalent). Backed by a plain in-memory Map so
// auth-client tests can exercise real get/set/delete round-trips without a device.

const store = new Map();

module.exports = {
  getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  setItemAsync: jest.fn(async (key, value) => {
    store.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key) => {
    store.delete(key);
  }),
};
