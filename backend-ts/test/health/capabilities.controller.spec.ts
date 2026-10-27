import { CapabilitiesController } from '../../src/modules/health/capabilities.controller';
import { supportedSandboxModes } from '../../src/common/services/sandbox-policy';

describe('CapabilitiesController', () => {
  it('返回后端平台与当前平台支持的会话档位', () => {
    const result = new CapabilitiesController().get();

    expect(result.platform).toBe(process.platform);
    expect(result.sandboxModes).toEqual(supportedSandboxModes(process.platform));
  });
});
