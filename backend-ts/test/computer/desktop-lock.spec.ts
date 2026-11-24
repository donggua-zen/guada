import { DesktopLock } from "../../src/modules/plugins/builtins/computer-use/desktop-lock";

describe("DesktopLock", () => {
  it("rejects a second holder with COMPUTER_BUSY after the wait budget", async () => {
    const lock = new DesktopLock();
    const release = await lock.acquire(1000);

    await expect(lock.acquire(20)).rejects.toMatchObject({
      code: "COMPUTER_BUSY",
    });

    release();
    const next = await lock.acquire(1000);
    next();
  });

  it("hands the lock to a waiter when the holder releases", async () => {
    const lock = new DesktopLock();
    const release = await lock.acquire(1000);

    let acquired = false;
    const waiter = lock.acquire(1000).then((releaseWaiter) => {
      acquired = true;
      return releaseWaiter;
    });

    expect(acquired).toBe(false);
    release();
    const releaseWaiter = await waiter;
    expect(acquired).toBe(true);
    releaseWaiter();
  });

  it("rejects a waiter when its signal aborts", async () => {
    const lock = new DesktopLock();
    const release = await lock.acquire(1000);
    const controller = new AbortController();

    const waiter = lock.acquire(1000, controller.signal);
    controller.abort();

    await expect(waiter).rejects.toMatchObject({ code: "CANCELLED" });
    release();
  });
});
