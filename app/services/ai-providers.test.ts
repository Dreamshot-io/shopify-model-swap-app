import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AIProviderFactory, FalAIProvider, ReplicateProvider, initializeAIProviders } from './ai-providers';

describe('AI Providers', () => {
  beforeEach(() => {
    // Arrange - Clear providers between tests
    AIProviderFactory.clear();
    // Ensure server environment
    delete (globalThis as any).window;
  });

  afterEach(() => {
    // Cleanup - Restore state
    delete (globalThis as any).window;
  });

  describe('Browser Environment Safety', () => {
    it('should throw error when initializeAIProviders called in browser', () => {
      // Arrange
      (globalThis as any).window = {};

      // Act & Assert
      expect(() => {
        initializeAIProviders('replicate-token', 'fal-key');
      }).toThrow('initializeAIProviders should only be called on the server');
    });

    it('should work in server environment with both providers', () => {
      // Arrange
      delete (globalThis as any).window;

      // Act
      initializeAIProviders('replicate-token', 'fal-key');

      // Assert
      expect(AIProviderFactory.hasProvider('replicate')).toBe(true);
      expect(AIProviderFactory.hasProvider('fal.ai')).toBe(true);
    });

    it('should work with only Replicate provider', () => {
      // Arrange
      delete (globalThis as any).window;

      // Act
      initializeAIProviders('replicate-token');

      // Assert
      expect(AIProviderFactory.hasProvider('replicate')).toBe(true);
      expect(AIProviderFactory.hasProvider('fal.ai')).toBe(false);
    });
  });

  describe('AIProviderFactory', () => {
    it('should register and retrieve providers', () => {
      // Arrange
      const mockProvider = new FalAIProvider('test-key');

      // Act
      AIProviderFactory.registerProvider('test', mockProvider);

      // Assert
      expect(AIProviderFactory.hasProvider('test')).toBe(true);
      expect(AIProviderFactory.getProvider('test')).toBe(mockProvider);
      expect(AIProviderFactory.getAvailableProviders()).toContain('test');
    });

    it('should throw descriptive error for missing provider', () => {
      // Arrange & Act & Assert
      expect(() => {
        AIProviderFactory.getProvider('nonexistent');
      }).toThrow(/AI Provider 'nonexistent' not found/);
    });
  });

  describe('FalAIProvider', () => {
    it('should create provider with API key', () => {
      // Arrange & Act
      const provider = new FalAIProvider('test-key');

      // Assert
      expect(provider.name).toBe('fal.ai');
    });

    it('should handle empty API key gracefully', () => {
      // Arrange & Act
      const provider = new FalAIProvider('');

      // Assert
      expect(provider.name).toBe('fal.ai');
    });
  });

  describe('ReplicateProvider', () => {
    it('should create provider with API token', () => {
      // Arrange & Act
      const provider = new ReplicateProvider('test-token');

      // Assert
      expect(provider.name).toBe('replicate');
    });

    it('should be registered as default provider', () => {
      // Arrange
      delete (globalThis as any).window;

      // Act
      initializeAIProviders('replicate-token', 'fal-key');
      const providers = AIProviderFactory.getAvailableProviders();

      // Assert
      expect(providers).toContain('replicate');
      expect(providers).toContain('fal.ai');
    });

    it('should work without fal.ai provider', () => {
      // Arrange
      delete (globalThis as any).window;

      // Act
      initializeAIProviders('replicate-token');

      // Assert
      expect(AIProviderFactory.hasProvider('replicate')).toBe(true);
      expect(AIProviderFactory.hasProvider('fal.ai')).toBe(false);
    });
  });

  describe('Multi-Provider Support', () => {
    it('should support both providers simultaneously', () => {
      // Arrange
      delete (globalThis as any).window;

      // Act
      initializeAIProviders('replicate-token', 'fal-key');
      const replicateProvider = AIProviderFactory.getProvider('replicate');
      const falProvider = AIProviderFactory.getProvider('fal.ai');

      // Assert
      expect(replicateProvider.name).toBe('replicate');
      expect(falProvider.name).toBe('fal.ai');
    });

    it('should list all available providers', () => {
      // Arrange
      delete (globalThis as any).window;

      // Act
      initializeAIProviders('replicate-token', 'fal-key');
      const providers = AIProviderFactory.getAvailableProviders();

      // Assert
      expect(providers).toHaveLength(2);
      expect(providers).toContain('replicate');
      expect(providers).toContain('fal.ai');
    });
  });
});