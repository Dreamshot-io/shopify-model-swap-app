// Vitest setup file for global test configuration
// Mock window.matchMedia for jsdom environment
// This must run before any Polaris components are imported
// Use plain functions (not vi.fn) so clearAllMocks doesn't affect them
if (typeof window !== 'undefined') {
	const createMediaQueryList = (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true,
	});
	
	const matchMediaMock = (query: string) => {
		return createMediaQueryList(query);
	};
	
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		configurable: true,
		value: matchMediaMock,
	});
}
