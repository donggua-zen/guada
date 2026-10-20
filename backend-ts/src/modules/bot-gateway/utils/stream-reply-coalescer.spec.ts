import { StreamReplyCoalescer } from './stream-reply-coalescer';

describe('StreamReplyCoalescer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function createSend() {
    return jest.fn().mockResolvedValue(undefined);
  }

  it('首个更新立即发送', () => {
    const send = createSend();
    const coalescer = new StreamReplyCoalescer(send, 150, jest.fn());

    coalescer.update('A');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('A');
    coalescer.dispose();
  });

  it('间隔内的连续更新只发送最新全文', async () => {
    const send = createSend();
    const coalescer = new StreamReplyCoalescer(send, 150, jest.fn());

    coalescer.update('A');
    coalescer.update('AB');
    coalescer.update('ABC');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('A');

    await jest.advanceTimersByTimeAsync(150);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('ABC');
    coalescer.dispose();
  });

  it('发送在途时不并发发送，结束后发送期间累积的最新内容', async () => {
    let resolveFirst: (() => void) | undefined;
    const send = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const coalescer = new StreamReplyCoalescer(send, 150, jest.fn());

    coalescer.update('A');
    expect(send).toHaveBeenCalledTimes(1);

    coalescer.update('AB');
    coalescer.update('ABC');
    expect(send).toHaveBeenCalledTimes(1);

    resolveFirst!();
    await jest.advanceTimersByTimeAsync(150);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('ABC');
    coalescer.dispose();
  });

  it('dispose 后不再发送待发中间帧', async () => {
    const send = createSend();
    const coalescer = new StreamReplyCoalescer(send, 150, jest.fn());

    coalescer.update('A');
    coalescer.update('AB');
    coalescer.dispose();

    await jest.advanceTimersByTimeAsync(1000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('A');
  });

  it('发送失败回调 onError，后续更新仍可发送', async () => {
    const onError = jest.fn();
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const coalescer = new StreamReplyCoalescer(send, 150, onError);

    coalescer.update('A');
    await jest.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ message: 'boom' });

    coalescer.update('AB');
    await jest.advanceTimersByTimeAsync(150);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('AB');
    coalescer.dispose();
  });
});
