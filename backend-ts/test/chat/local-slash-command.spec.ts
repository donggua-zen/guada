/**
 * 本地斜杠命令解析测试
 *
 * 约束：只有"整段输入就是 /compact（或别名 /compress）"才命中；
 * 未知命令、正文中的斜杠、多行文本一律不命中（按普通消息发给模型）。
 */
import { parseLocalSlashCommand } from '../../src/modules/chat/commands/local-slash-command';

describe('parseLocalSlashCommand', () => {
  it('裸命令命中（compact / compress 别名，大小写不敏感）', () => {
    expect(parseLocalSlashCommand('/compact')).toMatchObject({ name: 'compact' });
    expect(parseLocalSlashCommand('/compact')).not.toHaveProperty('instructions');
    expect(parseLocalSlashCommand('/compress')).toMatchObject({ name: 'compress' });
    expect(parseLocalSlashCommand('/COMPACT')).toMatchObject({ name: 'compact' });
    expect(parseLocalSlashCommand('  /compact  ')).toMatchObject({ name: 'compact' });
  });

  it('带自由文本指令：作为 instructions 返回（保留内部空格与换行）', () => {
    expect(parseLocalSlashCommand('/compact 只保留最近 10 轮')).toMatchObject({
      name: 'compact',
      instructions: '只保留最近 10 轮',
    });
    expect(
      parseLocalSlashCommand('/compact\n保留决策与文件路径\n丢弃工具输出'),
    ).toMatchObject({
      name: 'compact',
      instructions: '保留决策与文件路径\n丢弃工具输出',
    });
  });

  it('未知命令不命中（按普通消息处理）', () => {
    expect(parseLocalSlashCommand('/help')).toBeNull();
    expect(parseLocalSlashCommand('/clear')).toBeNull();
    expect(parseLocalSlashCommand('/usr/bin/env')).toBeNull();
  });

  it('正文中的斜杠不命中（避免误吞正常提问）', () => {
    expect(parseLocalSlashCommand('请解释 /compact 是什么意思')).toBeNull();
    expect(parseLocalSlashCommand('第一行\n/compact')).toBeNull();
    expect(parseLocalSlashCommand('看一下这个路径 /compact')).toBeNull();
    expect(parseLocalSlashCommand('/compactX')).toBeNull();
  });

  it('空值/纯斜杠不命中', () => {
    expect(parseLocalSlashCommand('')).toBeNull();
    expect(parseLocalSlashCommand(undefined)).toBeNull();
    expect(parseLocalSlashCommand(null)).toBeNull();
    expect(parseLocalSlashCommand('/')).toBeNull();
    expect(parseLocalSlashCommand('/123')).toBeNull();
  });
});
