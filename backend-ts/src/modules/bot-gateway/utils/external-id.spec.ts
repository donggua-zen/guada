import { appendResetMarker, extractBaseExternalId, hasResetMarker, getResetTimestamp } from './external-id';

describe('External ID Reset Marker Functions', () => {
  const baseExternalId = 'qq:private:AA7F81B2C3D4E5F6';

  describe('appendResetMarker', () => {
    it('should append timestamp to externalId', () => {
      const result = appendResetMarker(baseExternalId);
      expect(result).toContain(baseExternalId);
      expect(result).toContain('@');
    });

    it('should generate unique markers for different calls', () => {
      const result1 = appendResetMarker(baseExternalId);
      // Small delay to ensure different timestamps
      const now = Date.now();
      const result2 = `${baseExternalId}@${now + 1}`;
      expect(result1).not.toBe(result2);
    });
  });

  describe('extractBaseExternalId', () => {
    it('should extract base externalId without marker', () => {
      const marked = appendResetMarker(baseExternalId);
      const extracted = extractBaseExternalId(marked);
      expect(extracted).toBe(baseExternalId);
    });

    it('should return original if no marker exists', () => {
      const result = extractBaseExternalId(baseExternalId);
      expect(result).toBe(baseExternalId);
    });
  });

  describe('hasResetMarker', () => {
    it('should return true for marked externalId', () => {
      const marked = appendResetMarker(baseExternalId);
      expect(hasResetMarker(marked)).toBe(true);
    });

    it('should return false for unmarked externalId', () => {
      expect(hasResetMarker(baseExternalId)).toBe(false);
    });
  });

  describe('getResetTimestamp', () => {
    it('should extract valid timestamp', () => {
      const marked = appendResetMarker(baseExternalId);
      const timestamp = getResetTimestamp(marked);
      expect(timestamp).not.toBeNull();
      expect(typeof timestamp).toBe('number');
      expect(timestamp!).toBeGreaterThan(0);
    });

    it('should return null for unmarked externalId', () => {
      const timestamp = getResetTimestamp(baseExternalId);
      expect(timestamp).toBeNull();
    });

    it('should return null for invalid timestamp', () => {
      const invalid = `${baseExternalId}@invalid`;
      const timestamp = getResetTimestamp(invalid);
      expect(timestamp).toBeNull();
    });
  });

  describe('Round-trip consistency', () => {
    it('should maintain consistency through mark and extract', () => {
      const original = baseExternalId;
      const marked = appendResetMarker(original);
      const extracted = extractBaseExternalId(marked);
      expect(extracted).toBe(original);
    });
  });
});
