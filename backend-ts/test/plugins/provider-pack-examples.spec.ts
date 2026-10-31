/**
 * 仓库内示例供应商包的静态校验：确保文档/示例不会随 schema 漂移。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { parseProviderTypeCard } from '../../src/modules/llm-core/bundled-catalog.service';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');

function readManifest(dir: string) {
  return JSON.parse(
    fs.readFileSync(path.join(PLUGINS_DIR, dir, 'manifest.json'), 'utf8'),
  );
}

function readCard(cardPath: string, fallback: string) {
  const raw = yaml.load(
    fs.readFileSync(path.join(PLUGINS_DIR, cardPath), 'utf8'),
  ) as Record<string, any>;
  return parseProviderTypeCard(raw, fallback);
}

describe('示例供应商包', () => {
  it('声明式包：manifest 合法且类型卡可解析', () => {
    const manifest = readManifest('provider-pack-example');
    expect(manifest.providerApi).toBe(1);
    expect(manifest.provides.providerTypes).toEqual(['types/*.yaml']);

    const card = readCard('provider-pack-example/types/acme.yaml', 'acme');
    expect(card.type).toBe('acme');
    expect(card.protocol).toBe('openai');
    expect(card.models.length).toBeGreaterThan(0);
    expect(card.models.every((m) => m.modelType === 'embedding' || typeof m.supportsThinking === 'boolean')).toBe(true);
  });

  it('代码包：manifest 同时声明适配器与类型卡', () => {
    const manifest = readManifest('provider-ollama');
    expect(manifest.providerApi).toBe(1);
    expect(manifest.main).toBe('index.js');
    expect(manifest.provides.providerAdapters).toBe('index.js');

    const card = readCard('provider-ollama/types/ollama.yaml', 'ollama');
    expect(card.type).toBe('ollama');
    expect(card.protocol).toBe('ollama-native');
    expect(card.models.length).toBeGreaterThan(0);
  });
});
