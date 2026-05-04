import { SkillDefinition } from './skill-manifest.interface';

/**
 * 扫描结果模型
 */
export interface SkillDiscoveryResult {
  added: SkillDefinition[];
  updated: SkillDefinition[];
  removed: string[];
  errors: Array<{ path: string; error: string }>;
  scanDurationMs: number;
}

/**
 * 安装源模型
 */
export interface SkillSource {
  type: 'directory' | 'zip' | 'git';
  path?: string;
  buffer?: Buffer;
  url?: string;
  overwrite?: boolean;
}

/**
 * Script execution request model
 */
export interface ScriptExecutionRequest {
  skillId: string;
  scriptPath: string;            // relative path
  args?: string[];               // command line arguments
  env?: Record<string, string>;  // environment variables
  timeoutMs?: number;            // default 30000
  maxOutputBytes?: number;       // default 1MB
}

/**
 * Script execution result model
 */
export interface ScriptExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}
