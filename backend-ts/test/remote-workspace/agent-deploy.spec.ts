/// <reference types="jest" />

import { EventEmitter } from 'events';
import {
  buildRemoteBaseCommand,
  forwardFailureMessage,
  parseRemoteBaseDir,
  uploadBinary,
} from '../../src/modules/remote-workspace/agent-deploy';

describe('远端 agent 安装根目录探测（HOME 不可用时的回退）', () => {
  it('命中 $HOME 时标记为 isHome', () => {
    expect(parseRemoteBaseDir('GUADA_BASE:HOME:/home/donggua\n')).toEqual({
      path: '/home/donggua',
      isHome: true,
    });
  });

  it('回退目录标记为 isHome=false', () => {
    expect(parseRemoteBaseDir('GUADA_BASE:FALLBACK:/tmp\n')).toEqual({
      path: '/tmp',
      isHome: false,
    });
  });

  it('无候选可用时返回空路径（调用方据此报明确错误）', () => {
    expect(parseRemoteBaseDir('')).toEqual({ path: '', isHome: false });
    expect(parseRemoteBaseDir('Could not chdir to home directory\n')).toEqual({
      path: '',
      isHome: false,
    });
  });

  it('忽略无关输出行，只认标记行', () => {
    const raw = [
      'Could not chdir to home directory /home/u: No such file',
      'GUADA_BASE:FALLBACK:/var/tmp',
    ].join('\n');

    expect(parseRemoteBaseDir(raw)).toEqual({ path: '/var/tmp', isHome: false });
  });

  it('按 $HOME → 登录目录 → 常见临时目录的顺序探测，并以实际 mkdir 判定可写', () => {
    const cmd = buildRemoteBaseCommand();

    expect(cmd).toContain('for c in "$HOME" "$PWD" "/tmp" "/var/tmp" "/dev/shm"; do');
    expect(cmd).toContain('mkdir -p "$c/.guada-probe-$$"');
    expect(cmd).toContain('rmdir "$c/.guada-probe-$$"');
    // 不硬编码任何具体用户主目录
    expect(cmd).not.toMatch(/\/home\/[a-z]/);
  });
});

describe('端口转发失败原因（sshd 禁止转发时给出可操作提示）', () => {
  it('reason=1（ADMINISTRATIVELY_PROHIBITED）提示开启 AllowTcpForwarding', () => {
    const msg = forwardFailureMessage(1, 39001, '(SSH) Channel open failure: open failed');

    expect(msg).toContain('AllowTcpForwarding');
    expect(msg).toContain('端口转发被服务器拒绝');
  });

  it('reason=2（CONNECT_FAILED）指向远端端口不可达', () => {
    const msg = forwardFailureMessage(2, 39001, '(SSH) Channel open failure: open failed');

    expect(msg).toContain('39001');
    expect(msg).toContain('不可达');
  });

  it('其他原因回退到原始报错', () => {
    expect(forwardFailureMessage(undefined, 1, 'boom')).toContain('boom');
  });
});

/** 假的 exec 通道：记录写入内容；命令类通道自动输出并收尾，上传类通道等 end() 收尾 */
class FakeChannel extends EventEmitter {
  readonly written: Buffer[] = [];
  readonly stderr = new EventEmitter();
  constructor(
    private readonly exitCode: number = 0,
    private readonly stdout: string = '',
    /** true 表示像普通命令一样自行输出并退出（供 execCommand 等待 close） */
    autoRun = false,
  ) {
    super();
    if (autoRun) {
      // execCommand 会先挂监听再等 close，输出必须异步发出，不能同步 emit
      setImmediate(() => this.finish());
    }
  }
  write(chunk: Buffer): boolean {
    this.written.push(chunk);
    return true;
  }
  end(): void {
    this.finish();
  }
  private finish(): void {
    if (this.stdout) this.emit('data', Buffer.from(this.stdout));
    this.emit('exit', this.exitCode);
    this.emit('close');
  }
}

/**
 * 假 client：
 * - sftp() 按 sftpError 模拟「NAS 上 SFTP 视图与真实文件系统不一致」
 * - exec('cat > …') 返回上传通道（等 end() 收尾）
 * - exec('wc -c < …') 返回远端字节数（自动收尾）
 */
function makeFakeClient(options: { sftpError?: Error; remoteSize?: string; uploadExitCode?: number }) {
  const uploadChannel = new FakeChannel(options.uploadExitCode ?? 0);
  return {
    uploadChannel,
    client: {
      sftp: (cb: (err: Error | null, sftp?: unknown) => void) => {
        if (options.sftpError) return cb(options.sftpError);
        cb(null, { fastPut: (_l: string, _r: string, done: (e: Error | null) => void) => done(null) });
      },
      exec: (cmd: string, cb: (err: null, stream: unknown) => void) => {
        if (cmd.startsWith('cat >')) return cb(null, uploadChannel);
        return cb(null, new FakeChannel(0, (options.remoteSize ?? '0') + '\n', true));
      },
    },
  };
}

describe('agent 二进制上传（SFTP 不可用时回退 exec 通道）', () => {
  it('SFTP 失败时回退 exec 通道，并按远端字节数校验完整性', async () => {
    const local = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'guada-up-'));
    const localFile = require('path').join(local, 'agent.bin');
    require('fs').writeFileSync(localFile, Buffer.alloc(1024, 7));

    const warn: string[] = [];
    const { client, uploadChannel } = makeFakeClient({ sftpError: new Error('No such file'), remoteSize: '1024' });

    await uploadBinary(client as never, localFile, '/tmp/.guada-agent/guada-agent', (l) => warn.push(l));

    expect(warn[0]).toContain('SFTP upload failed');
    expect(warn.join('\n')).toContain('retrying over the SSH channel');
    expect(warn.join('\n')).toContain('Uploaded 1024 bytes');
    // 原始字节写入，不做编码转换
    expect(Buffer.concat(uploadChannel.written).length).toBe(1024);

    require('fs').rmSync(local, { recursive: true, force: true });
  });

  it('远端字节数与本地不一致时报错（避免上传被截断却继续启动 agent）', async () => {
    const local = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'guada-up-'));
    const localFile = require('path').join(local, 'agent.bin');
    require('fs').writeFileSync(localFile, Buffer.alloc(1024, 7));

    const { client } = makeFakeClient({ sftpError: new Error('No such file'), remoteSize: '512' });

    await expect(
      uploadBinary(client as never, localFile, '/tmp/.guada-agent/guada-agent'),
    ).rejects.toThrow(/size mismatch/);

    require('fs').rmSync(local, { recursive: true, force: true });
  });

  it('SFTP 可用时不走 exec 通道', async () => {
    const local = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'guada-up-'));
    const localFile = require('path').join(local, 'agent.bin');
    require('fs').writeFileSync(localFile, Buffer.alloc(64, 1));

    const { client, uploadChannel } = makeFakeClient({ remoteSize: '64' });

    await uploadBinary(client as never, localFile, '/tmp/.guada-agent/guada-agent');

    expect(uploadChannel.written.length).toBe(0);

    require('fs').rmSync(local, { recursive: true, force: true });
  });
});
