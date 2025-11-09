import { describe, it, expect, beforeEach } from '@jest/globals';
import { AIProviderFactory, FalAIProvider, ReplicateProvider, initializeAIProviders } from './ai-providers';

// Mock process.env for browser environment test
const originalProcess = globalThis.process;

describe('AI Providers', () => {
  beforeEach(() => {
    // Clear providers between tests
    AIProviderFactory.clear();
  });

  afterAll(() => {
    // Restore original process
    globalThis.process = originalProcess;
  });

  describe('Browser Environment Safety', () => {
    it('should throw error when initializeAIProviders called in browser', () => {
      // Mock window to simulate browser environment
      (globalThis as any).window = {};

      expect(() => {
        initializeAIProviders('replicate-token', 'fal-key');
      }).toThrow('initializeAIProviders should only be called on the server');

      delete (globalThis as any).window;
    });

    it('should work in server environment with both providers', () => {
      // Ensure we're in server environment (no window)
      delete (globalThis as any).window;

      expect(() => {
        initializeAIProviders('replicate-token', 'fal-key');
      }).not.toThrow();

      expect(AIProviderFactory.hasProvider('replicate')).toBe(true);
      expect(AIProviderFactory.hasProvider('fal.ai')).toBe(true);
    });

    it('should work with only Replicate provider', () => {
      // Ensure we're in server environment (no window)
      delete (globalThis as any).window;

      expect(() => {
        initializeAIProviders('replicate-token');
      }).not.toThrow();

      expect(AIProviderFactory.hasProvider('replicate')).toBe(true);
      expect(AIProviderFactory.hasProvider('fal.ai')).toBe(false);
    });
  });

  describe('AIProviderFactory', () => {
    it('should register and retrieve providers', () => {
      const mockProvider = new FalAIProvider('test-key');
      AIProviderFactory.registerProvider('test', mockProvider);
      
      expect(AIProviderFactory.hasProvider('test')).toBe(true);
      expect(AIProviderFactory.getProvider('test')).toBe(mockProvider);
      expect(AIProviderFactory.getAvailableProviders()).toContain('test');
    });

    it('should throw descriptive error for missing provider', () => {
      expect(() => {
        AIProviderFactory.getProvider('nonexistent');
      }).toThrow(/AI Provider 'nonexistent' not found/);
    });
  });

  describe('FalAIProvider', () => {
    it('should create provider with API key', () => {
      const provider = new FalAIProvider('test-key');
      expect(provider.name).toBe('fal.ai');
    });

    it('should handle empty API key gracefully', () => {
      const provider = new FalAIProvider('');
      expect(provider.name).toBe('fal.ai');
    });
  });

  describe('ReplicateProvider', () => {
    it('should create provider with API token', () => {
      const provider = new ReplicateProvider('test-token');
      expect(provider.name).toBe('replicate');
    });

    it('should be registered as default provider', () => {
      delete (globalThis as any).window;
      initializeAIProviders('replicate-token', 'fal-key');

      const providers = AIProviderFactory.getAvailableProviders();
      expect(providers).toContain('replicate');
      expect(providers).toContain('fal.ai');
    });

    it('should work without fal.ai provider', () => {
      delete (globalThis as any).window;
      initializeAIProviders('replicate-token');

      expect(AIProviderFactory.hasProvider('replicate')).toBe(true);
      expect(AIProviderFactory.hasProvider('fal.ai')).toBe(false);
    });
  });

  describe('Multi-Provider Support', () => {
    it('should support both providers simultaneously', () => {
      delete (globalThis as any).window;
      initializeAIProviders('replicate-token', 'fal-key');

      const replicateProvider = AIProviderFactory.getProvider('replicate');
      const falProvider = AIProviderFactory.getProvider('fal.ai');

      expect(replicateProvider.name).toBe('replicate');
      expect(falProvider.name).toBe('fal.ai');
    });

    it('should list all available providers', () => {
      delete (globalThis as any).window;
      initializeAIProviders('replicate-token', 'fal-key');

      const providers = AIProviderFactory.getAvailableProviders();
      expect(providers).toHaveLength(2);
      expect(providers).toContain('replicate');
      expect(providers).toContain('fal.ai');
    });
  });
});