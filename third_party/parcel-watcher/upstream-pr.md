# Upstream PR draft — parcel-bundler/watcher

Not submitted yet. Review before pushing. Target: fix for issue #262 (Windows: crash on
unsubscribe while a change notification is pending).

---

## Title

fix(windows): keep Subscription alive until its overlapped read completes

## Body

The Windows backend stores a raw `Subscription *` in `OVERLAPPED::hEvent` and frees the
object in `unsubscribe()` (`watcher->state = nullptr`). `~Subscription` then runs
`CancelIo(mDirectoryHandle); CloseHandle(mDirectoryHandle)` while the
`ReadDirectoryChangesW` submitted by the backend thread is still pending:

- `CancelIo` only cancels I/O submitted **by the calling thread**. Unsubscribe runs on the
  NAPI thread, so the request is never cancelled.
- The handle is closed with an IRP still attached. The completion (including
  `ERROR_OPERATION_ABORTED`) is queued to the backend thread's alertable wait regardless,
  and the callback dereferences the freed object:
  `reinterpret_cast<Subscription *>(overlapped->hEvent)` → read `mRunning` → access violation.

So any file change in a watched directory after `unsubscribe()` crashes the host process,
with no JS stack and no way to catch it (`0xC0000005` / `EXC_BAD_ACCESS`). This matches
#262; it is not limited to the rapid-switch case.

### Fix

Make the object's lifetime follow the I/O instead of the other way round:

- `Subscription` becomes `enable_shared_from_this`, and every in-flight
  `ReadDirectoryChangesW` owns a heap `PendingIo` holding a `shared_ptr<Subscription>`, which
  is what `hEvent` points at. The completion callback takes that reference out before
  releasing the record, so the object cannot be destroyed while the callback runs.
- `stop()` becomes `requestStop()`: it only clears `mRunning` and calls `CancelIoEx`
  (thread-independent cancellation). `CloseHandle` moves to the destructor, which now runs
  only once no operation is in flight.
- `QueueUserAPC` gets a heap `shared_ptr` instead of a raw pointer, so an APC whose
  subscription was cancelled before it ran still operates on a live object.

### Reproduction / verification

`repro.js` (run with the released 2.6.0 binary vs. this patch, three temp dirs, ~3000 rounds):

| case | shape | 2.6.0 | patched |
| ---- | ----- | ----- | ------- |
| `churnwrite` | writes every 1ms **and** subscribe→unsubscribe loop | crashes 5/5, exit `0xC0000005` | 8/8 clean |
| `churn` | subscribe→unsubscribe loop, no writes | crashes ~1/10 | 6/6 clean at 5000 rounds |
| `writeonly` | writes, no unsubscribe | clean | clean |
| `events` | events delivered, then 30 writes after `unsubscribe()` | clean before the writes | clean, events still delivered |

Behaviour is unchanged otherwise: events still arrive, unsubscribing still stops delivery,
and the `ERROR_OPERATION_ABORTED` path still returns without re-arming.

### Notes / follow-ups (not in this PR)

- `poll()` checks `mRunning` and then calls `ReadDirectoryChangesW` without the backend
  mutex, while `requestStop()` runs under it. If unsubscribe lands inside that window the
  IRP is submitted after the cancel and stays pending (leaked subscription + directory
  handle, no crash). Closing it needs the check and the submit under `mBackend->mMutex`;
  done deliberately in a separate change because `handleWatcherError()` → `unwatch()` also
  takes that mutex from the callback thread and the lock order should be reviewed.
- `Subscription`'s constructor throws `"Invalid handle"` / `"Could not get file information"`
  after `CreateFileW` succeeded; C++ doesn't run the destructor of a constructor that threw,
  so the opened handle leaks. The `subscribe()` path in the app hits this when a watched
  directory is deleted.
- Measured while validating this patch: a fast subscribe/unsubscribe loop raises the
  process handle count from ~280 (idle node) to a plateau of ~1310, identically with and
  without this patch, and independent of how many rounds are run (1500 rounds and 6000
  rounds both peak ~1310). So it is bounded, not a per-unsubscribe leak; cause unknown,
  and not made worse by this change.
