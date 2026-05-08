import '@testing-library/jest-dom'
import i18n from '../i18n'

// React 18 concurrent rendering fixes
// Disable React's concurrent mode in tests to prevent act() errors
if (typeof globalThis !== 'undefined') {
  // Mock React's concurrent features for testing
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
}

const storage = (() => {
	const store = new Map();
	return {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => {
			store.set(String(key), String(value));
		},
		removeItem: (key) => {
			store.delete(String(key));
		},
		clear: () => {
			store.clear();
		},
		key: (index) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	};
})();

if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
	Object.defineProperty(globalThis, 'localStorage', {
		value: storage,
		configurable: true,
		writable: true,
	});
}

if (typeof globalThis.window !== 'undefined') {
	Object.defineProperty(globalThis.window, 'localStorage', {
		value: globalThis.localStorage,
		configurable: true,
		writable: true,
	});
}

globalThis.localStorage.setItem('easymod_lang', 'en');
void i18n.changeLanguage('en');