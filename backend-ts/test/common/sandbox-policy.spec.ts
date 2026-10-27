/**
 * 平台档位收敛：
 * - Windows 不再向用户提供 read-only（shell 只有命令白名单，不是真正的只读沙盒）；
 * - 其它平台保留三档；
 * - 未知持久化值 fail-safe 回退 workspace-write。
 *
 * 平台显式传参，避免 Windows/Linux CI 行为分叉。
 */
import {
  ALL_SANDBOX_MODES,
  isSandboxModeSupported,
  normalizeSandboxMode,
  supportedSandboxModes,
} from '../../src/common/services/sandbox-policy';

describe('sandbox-policy 平台档位', () => {
  it('词表仍是三档（内部只读保留给计划模式与 macOS/Linux）', () => {
    expect(ALL_SANDBOX_MODES).toEqual([
      'read-only',
      'workspace-write',
      'danger-full-access',
    ]);
  });

  it('Windows 只提供 workspace-write / danger-full-access', () => {
    expect(supportedSandboxModes('win32')).toEqual([
      'workspace-write',
      'danger-full-access',
    ]);
    expect(isSandboxModeSupported('read-only', 'win32')).toBe(false);
    expect(isSandboxModeSupported('workspace-write', 'win32')).toBe(true);
    expect(isSandboxModeSupported('danger-full-access', 'win32')).toBe(true);
  });

  it('macOS / Linux 保留三档', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(supportedSandboxModes(platform)).toEqual([
        'read-only',
        'workspace-write',
        'danger-full-access',
      ]);
      expect(isSandboxModeSupported('read-only', platform)).toBe(true);
    }
  });

  it('Windows 上 read-only 归一化为 workspace-write', () => {
    expect(normalizeSandboxMode('read-only', 'win32')).toBe('workspace-write');
    expect(normalizeSandboxMode('workspace-write', 'win32')).toBe(
      'workspace-write',
    );
    expect(normalizeSandboxMode('danger-full-access', 'win32')).toBe(
      'danger-full-access',
    );
  });

  it('macOS / Linux 上 read-only 保持原值', () => {
    expect(normalizeSandboxMode('read-only', 'darwin')).toBe('read-only');
    expect(normalizeSandboxMode('read-only', 'linux')).toBe('read-only');
  });

  it('未知值 fail-safe 回退 workspace-write（不放开到 danger）', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(normalizeSandboxMode('yolo', platform)).toBe('workspace-write');
      expect(normalizeSandboxMode(undefined, platform)).toBe(
        'workspace-write',
      );
      expect(normalizeSandboxMode(null, platform)).toBe('workspace-write');
    }
  });
});
