import { describe, it, expect, beforeEach } from '@jest/globals';
import { AIProviderFactory, FalAIProvider, initializeAIProviders } from './ai-providers';

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
        initializeAIProviders('test-key');
      }).toThrow('initializeAIProviders should only be called on the server');
      
      delete (globalThis as any).window;
    });

    it('should work in server environment', () => {
      // Ensure we're in server environment (no window)
      delete (globalThis as any).window;
      
      expect(() => {
        initializeAIProviders('test-key');
      }).not.toThrow();
      
      expect(AIProviderFactory.hasProvider('fal.ai')).toBe(true);
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
});