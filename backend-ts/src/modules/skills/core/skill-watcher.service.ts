import { Injectable, Logger } from '@nestjs/common';
import { SkillDiscoveryService } from './skill-discovery.service';

/**
 * Skill 文件监听器服务（已禁用自动监听）
 * 改为通过 skill_scan 工具手动触发扫描
 */
@Injectable()
export class SkillWatcherService {
  private readonly logger = new Logger(SkillWatcherService.name);

  constructor(
    private discoveryService: SkillDiscoveryService,
  ) {
    this.logger.log('Skills file watching is disabled. Use skill_scan tool to manually refresh skills.');
  }

  /**
   * 仅保留扫描能力供外部手动调用
   */
  get discovery(): SkillDiscoveryService {
    return this.discoveryService;
  }
}
