#include <string>
#include <stack>
#include "../DirTree.hh"
#include "../shared/BruteForceBackend.hh"
#include "./WindowsBackend.hh"
#include "./win_utils.hh"

#define DEFAULT_BUF_SIZE 1024 * 1024
#define NETWORK_BUF_SIZE 64 * 1024
#define CONVERT_TIME(ft) ULARGE_INTEGER{ft.dwLowDateTime, ft.dwHighDateTime}.QuadPart

void BruteForceBackend::readTree(WatcherRef watcher, std::shared_ptr<DirTree> tree) {
  std::stack<std::string> directories;

  directories.push(watcher->mDir);

  while (!directories.empty()) {
    HANDLE hFind = INVALID_HANDLE_VALUE;

    std::string path = directories.top();
    std::string spec = path + "\\*";
    directories.pop();

    WIN32_FIND_DATA ffd;
    hFind = FindFirstFile(spec.c_str(), &ffd);

    if (hFind == INVALID_HANDLE_VALUE)  {
      if (path == watcher->mDir) {
        FindClose(hFind);
        throw WatcherError("Error opening directory", watcher);
      }

      tree->remove(path);
      continue;
    }

    do {
      if (strcmp(ffd.cFileName, ".") != 0 && strcmp(ffd.cFileName, "..") != 0) {
        std::string fullPath = path + "\\" + ffd.cFileName;
        if (watcher->isIgnored(fullPath)) {
          continue;
        }

        tree->add(fullPath, CONVERT_TIME(ffd.ftLastWriteTime), ffd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY);
        if (ffd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
          directories.push(fullPath);
        }
      }
    } while (FindNextFile(hFind, &ffd) != 0);

    FindClose(hFind);
  }
}

void WindowsBackend::start() {
  mRunning = true;
  notifyStarted();

  while (mRunning) {
    SleepEx(INFINITE, true);
  }
}

WindowsBackend::~WindowsBackend() {
  // Mark as stopped, and queue a noop function in the thread to break the loop
  mRunning = false;
  QueueUserAPC([](__in ULONG_PTR) {}, mThread.native_handle(), (ULONG_PTR)this);
}

class Subscription: public WatcherState, public std::enable_shared_from_this<Subscription> {
public:
  // Each in-flight ReadDirectoryChangesW keeps a strong reference to this
  // subscription on the heap, released by its own completion callback, so the
  // object can never be freed while the OS still owns a pointer to it.
  struct PendingIo {
    std::shared_ptr<Subscription> subscription;
  };

  Subscription(WindowsBackend *backend, WatcherRef watcher, std::shared_ptr<DirTree> tree) {
    mRunning = true;
    mBackend = backend;
    mWatcher = watcher;
    mTree = tree;
    ZeroMemory(&mOverlapped, sizeof(OVERLAPPED));
    mReadBuffer.resize(DEFAULT_BUF_SIZE);
    mWriteBuffer.resize(DEFAULT_BUF_SIZE);

    mDirectoryHandle = CreateFileW(
      utf8ToUtf16(watcher->mDir).data(),
      FILE_LIST_DIRECTORY,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      NULL,
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED,
      NULL
    );

    if (mDirectoryHandle == INVALID_HANDLE_VALUE) {
      throw WatcherError("Invalid handle", mWatcher);
    }

    // Ensure that the path is a directory
    BY_HANDLE_FILE_INFORMATION info;
    bool success = GetFileInformationByHandle(
      mDirectoryHandle,
      &info
    );

    if (!success) {
      throw WatcherError("Could not get file information", mWatcher);
    }

    if (!(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
      throw WatcherError("Not a directory", mWatcher);
    }
  }

  virtual ~Subscription() {
    // Reaching here means no overlapped operation is in flight, since each one
    // holds a strong reference. The handle is therefore safe to close.
    mRunning = false;
    if (mDirectoryHandle != INVALID_HANDLE_VALUE) {
      CloseHandle(mDirectoryHandle);
      mDirectoryHandle = INVALID_HANDLE_VALUE;
    }
  }

  void run() {
    try {
      poll();
    } catch (WatcherError &err) {
      mBackend->handleWatcherError(err);
    }
  }

  // Only requests the stop: cancels pending reads without freeing anything.
  // Actual destruction happens once the last completion callback releases its
  // reference. CancelIo only affects I/O submitted by the calling thread, and
  // unsubscribe runs on the NAPI thread, so CancelIoEx is required here.
  void requestStop() {
    mRunning = false;
    if (mDirectoryHandle != INVALID_HANDLE_VALUE) {
      CancelIoEx(mDirectoryHandle, NULL);
    }
  }

  void poll() {
    if (!mRunning) {
      return;
    }

    // Asynchronously wait for changes.
    // hEvent carries the in-flight operation's own strong reference, not this.
    // That keeps the Subscription alive for the whole duration of the
    // completion callback, so unsubscribing can never make us dereference
    // freed memory.
    auto *io = new PendingIo{shared_from_this()};
    ZeroMemory(&mOverlapped, sizeof(OVERLAPPED));
    mOverlapped.hEvent = io;
    int success = ReadDirectoryChangesW(
      mDirectoryHandle,
      mWriteBuffer.data(),
      static_cast<DWORD>(mWriteBuffer.size()),
      TRUE, // recursive
      FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_ATTRIBUTES
        | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE,
      NULL,
      &mOverlapped,
      [](DWORD errorCode, DWORD numBytes, LPOVERLAPPED overlapped) {
        std::unique_ptr<PendingIo> io(static_cast<PendingIo *>(overlapped->hEvent));
        // Take the strong reference out before dropping the in-flight record:
        // if this was the last one, the object still outlives this callback.
        std::shared_ptr<Subscription> subscription = std::move(io->subscription);
        io.reset();
        if (!subscription) {
          return;
        }
        try {
          subscription->processEvents(errorCode);
        } catch (WatcherError &err) {
          subscription->mBackend->handleWatcherError(err);
        }
      }
    );

    if (!success) {
      delete io;
      throw WatcherError("Failed to read changes", mWatcher);
    }
  }

  void processEvents(DWORD errorCode) {
    if (!mRunning) {
      return;
    }

    switch (errorCode) {
      case ERROR_OPERATION_ABORTED:
        return;
      case ERROR_INVALID_PARAMETER:
        // resize buffers to network size (64kb), and try again
        mReadBuffer.resize(NETWORK_BUF_SIZE);
        mWriteBuffer.resize(NETWORK_BUF_SIZE);
        poll();
        return;
      case ERROR_NOTIFY_ENUM_DIR:
        throw WatcherError("Buffer overflow. Some events may have been lost.", mWatcher);
      case ERROR_ACCESS_DENIED: {
        // This can happen if the watched directory is deleted. Check if that is the case,
        // and if so emit a delete event. Otherwise, fall through to default error case.
        DWORD attrs = GetFileAttributesW(utf8ToUtf16(mWatcher->mDir).data());
        bool isDir = attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY);
        if (!isDir) {
          mWatcher->mEvents.remove(mWatcher->mDir);
          mTree->remove(mWatcher->mDir);
          mWatcher->notify();
          requestStop();
          return;
        }
      }
      default:
        if (errorCode != ERROR_SUCCESS) {
          throw WatcherError("Unknown error", mWatcher);
        }
    }

    // Swap read and write buffers, and poll again
    std::swap(mWriteBuffer, mReadBuffer);
    poll();

    // Read change events
    BYTE *base = mReadBuffer.data();
    while (true) {
      PFILE_NOTIFY_INFORMATION info = (PFILE_NOTIFY_INFORMATION)base;
      processEvent(info);

      if (info->NextEntryOffset == 0) {
        break;
      }

      base += info->NextEntryOffset;
    }

    mWatcher->notify();
  }

  void processEvent(PFILE_NOTIFY_INFORMATION info) {
    std::string path = mWatcher->mDir + "\\" + utf16ToUtf8(info->FileName, info->FileNameLength / sizeof(WCHAR));
    if (mWatcher->isIgnored(path)) {
      return;
    }

    switch (info->Action) {
      case FILE_ACTION_ADDED:
      case FILE_ACTION_RENAMED_NEW_NAME: {
        WIN32_FILE_ATTRIBUTE_DATA data;
        if (GetFileAttributesExW(utf8ToUtf16(path).data(), GetFileExInfoStandard, &data)) {
          mWatcher->mEvents.create(path);
          mTree->add(path, CONVERT_TIME(data.ftLastWriteTime), data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY);
        }
        break;
      }
      case FILE_ACTION_MODIFIED: {
        WIN32_FILE_ATTRIBUTE_DATA data;
        if (GetFileAttributesExW(utf8ToUtf16(path).data(), GetFileExInfoStandard, &data)) {
          mTree->update(path, CONVERT_TIME(data.ftLastWriteTime));
          if (!(data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
            mWatcher->mEvents.update(path);
          }
        }
        break;
      }
      case FILE_ACTION_REMOVED:
      case FILE_ACTION_RENAMED_OLD_NAME:
        mWatcher->mEvents.remove(path);
        mTree->remove(path);
        break;
    }
  }

private:
  WindowsBackend *mBackend;
  std::shared_ptr<Watcher> mWatcher;
  std::shared_ptr<DirTree> mTree;
  bool mRunning;
  HANDLE mDirectoryHandle;
  std::vector<BYTE> mReadBuffer;
  std::vector<BYTE> mWriteBuffer;
  OVERLAPPED mOverlapped;
};

// This function is called by Backend::watch which takes a lock on mMutex
void WindowsBackend::subscribe(WatcherRef watcher) {
  // Create a subscription for this watcher
  auto sub = std::make_shared<Subscription>(this, watcher, getTree(watcher, false));
  watcher->state = sub;

  // Queue polling for this subscription in the correct thread.
  // The APC parameter is a heap-allocated strong reference as well, so the
  // object survives even if it is unsubscribed before the APC runs.
  auto *holder = new std::shared_ptr<Subscription>(sub);
  bool success = QueueUserAPC([](__in ULONG_PTR ptr) {
    std::unique_ptr<std::shared_ptr<Subscription>> holder(
      reinterpret_cast<std::shared_ptr<Subscription> *>(ptr));
    (*holder)->run();
  }, mThread.native_handle(), reinterpret_cast<ULONG_PTR>(holder));

  if (!success) {
    delete holder;
    throw std::runtime_error("Unable to queue APC");
  }
}

// This function is called by Backend::unwatch which takes a lock on mMutex
void WindowsBackend::unsubscribe(WatcherRef watcher) {
  // RTTI is disabled in this build, so dynamic_pointer_cast is unavailable.
  // watcher->state is only ever assigned by WindowsBackend::subscribe above,
  // so the downcast is safe by construction (and yields null when unset).
  auto sub = std::static_pointer_cast<Subscription>(watcher->state);
  watcher->state = nullptr;
  // Request the stop only; do not release here. After the pending read is
  // cancelled, the final completion callback still holds a strong reference
  // and performs the destruction. Clearing state alone (the previous
  // behaviour) left the backend thread running a completion callback on an
  // object that had already been freed.
  if (sub) {
    sub->requestStop();
  }
}
