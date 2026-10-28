import { isMeaningfulSenderName } from './bot-user';

describe('isMeaningfulSenderName', () => {
  it('accepts real nicknames', () => {
    expect(isMeaningfulSenderName('张三', 'openid-1')).toBe(true);
    expect(
      isMeaningfulSenderName('ZhenDongDong', 'ZhenDongDong-openid'),
    ).toBe(true);
  });

  it('rejects empty names and ids used as names', () => {
    expect(isMeaningfulSenderName(undefined, 'id')).toBe(false);
    expect(isMeaningfulSenderName('   ', 'id')).toBe(false);
    expect(isMeaningfulSenderName('openid-1', 'openid-1')).toBe(false);
  });

  it('rejects platform placeholders', () => {
    expect(isMeaningfulSenderName('用户', 'openid-1')).toBe(false);
    expect(isMeaningfulSenderName('Unknown', 'openid-1')).toBe(false);
    expect(isMeaningfulSenderName('unknown', 'openid-1')).toBe(false);
  });
});
