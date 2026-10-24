/**
 * Windows Job Object + suspended CreateProcessW primitives.
 *
 * Why this exists (aligned with DSH `packages/subprocess/win32-process`):
 * - Create the child with `CREATE_SUSPENDED`, assign it to a kill-on-close Job,
 *   then resume. This closes the race where a shell spawns descendants before
 *   the parent gets a chance to attach it to the Job.
 * - Closing the Job handle after the direct child exits terminates every
 *   descendant still in the Job (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE), so we no
 *   longer need `taskkill /T` or the MSYS `/proc` sweep for native entries.
 * - stdout/stderr share one anonymous pipe whose write end the child tree
 *   inherits; the parent keeps the read end and drains it with
 *   PeekNamedPipe + ReadFile (both non-blocking after a peek, safe on the JS
 *   thread). stdin is an anonymous pipe whose write end is kept by the caller
 *   for the `process write` tool.
 *
 * This module is deliberately self-contained and optional: if Koffi or the
 * native calls are unavailable, callers fall back to the legacy Node spawn path.
 */

import { Logger } from "@nestjs/common";

const logger = new Logger("Win32JobProcess");

// ── Win32 constants ──────────────────────────────────────────────────────────

/** Terminate every Job member when the last Job handle closes. */
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;
/** SetInformationJobObject class for JOBOBJECT_EXTENDED_LIMIT_INFORMATION. */
export const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
/** Create the child suspended so it cannot run before Job assignment. */
export const CREATE_SUSPENDED = 0x0000_0004;
/** The environment block is UTF-16LE. */
export const CREATE_UNICODE_ENVIRONMENT = 0x0000_0400;
/** Do not create a console window for console applications. */
export const CREATE_NO_WINDOW = 0x0800_0000;
/** STARTUPINFOW carries explicit stdio handles. */
export const STARTF_USESTDHANDLES = 0x0000_0100;
/** Allow a handle to be inherited by a child process. */
export const HANDLE_FLAG_INHERIT = 0x0000_0001;

const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const WAIT_OBJECT_0 = 0;
const WAIT_FAILED = 0xffff_ffff;
// ── Public types ─────────────────────────────────────────────────────────────

/** Koffi returns Win32 handles as bigint pointer values. 0n means NULL. */
export type NativeHandle = bigint;

export interface NativeSpawnOptions {
  /** Executable path (lpApplicationName). */
  program: string;
  /** Arguments excluding the program path. */
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface NativeProcessHandle {
  pid: number;
  /** Direct child process handle (owned by the caller). */
  process: NativeHandle;
  /** Kill-on-close Job handle (owned by the caller). */
  job: NativeHandle;
  /** stdin pipe write end, or null if stdin could not be created. */
  stdinWrite: NativeHandle | null;
  /** Output pipe read end (owned by the caller; drains the child's stdout+stderr). */
  outputRead: NativeHandle;
}

export class Win32JobError extends Error {
  constructor(
    readonly operation: string,
    readonly win32Code: number,
  ) {
    super(`${operation} failed (Win32 error ${win32Code})`);
    this.name = "Win32JobError";
  }
}

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Quote one argument according to CommandLineToArgvW parsing (the same
 * algorithm used by DSH). This is correct for Git Bash / PowerShell argv
 * handoff; cmd.exe has its own `/s /c` rules and should stay on the legacy
 * spawn path.
 */
export function quoteArg(argument: string): string {
  if (argument === "") return '""';
  if (!/[\s"]/u.test(argument)) return argument;

  let quoted = '"';
  for (let index = 0; index < argument.length; index++) {
    let backslashes = 0;
    while (index < argument.length && argument.charAt(index) === "\\") {
      backslashes += 1;
      index += 1;
    }
    if (index === argument.length) {
      quoted += "\\".repeat(backslashes * 2);
    } else if (argument.charAt(index) === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + '"';
    } else {
      quoted += "\\".repeat(backslashes) + argument.charAt(index);
    }
  }
  return quoted + '"';
}

/** Build the mutable command line accepted by CreateProcessW. */
export function buildCommandLine(
  program: string,
  args: readonly string[],
): string {
  return [program, ...args].map(quoteArg).join(" ");
}

/**
 * Build a UTF-16LE environment block (double-NUL terminated, sorted by name).
 * CreateProcessW must be called with CREATE_UNICODE_ENVIRONMENT.
 */
export function buildEnvironmentBlock(env: NodeJS.ProcessEnv): Buffer {
  const entries = Object.entries(env).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  entries.sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const text =
    entries.map(([key, value]) => `${key}=${String(value)}`).join("\0") +
    "\0\0";
  return Buffer.from(text, "utf16le");
}

// ── Koffi API (lazy, Windows-only) ───────────────────────────────────────────

interface Win32JobApi {
  createJobObject(): NativeHandle;
  /** Anonymous pipe whose write end is inheritable (stdout/stderr of the child). */
  createStdoutPipe(): { read: NativeHandle; write: NativeHandle };
  createStdinPipe(): { read: NativeHandle; write: NativeHandle };
  createProcessSuspended(options: {
    program: string;
    commandLine: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdinRead: NativeHandle;
    stdoutHandle: NativeHandle;
  }): { pid: number; process: NativeHandle; thread: NativeHandle };
  assignProcessToJob(job: NativeHandle, process: NativeHandle): void;
  resumeThread(thread: NativeHandle): void;
  isProcessExited(process: NativeHandle): boolean;
  getExitCode(process: NativeHandle): number;
  writeFile(handle: NativeHandle, data: Buffer): number;
  /** Bytes currently buffered in the pipe; null when the write end is closed (EOF). */
  peekPipe(handle: NativeHandle): number | null;
  /** Read up to buffer.length bytes from the pipe; returns bytes actually read. */
  readPipe(handle: NativeHandle, buffer: Buffer): number;
  terminateJob(job: NativeHandle, exitCode: number): void;
  terminateProcess(process: NativeHandle, exitCode: number): void;
  closeHandle(handle: NativeHandle): void;
  lastError(): number;
}

let apiPromise: Promise<Win32JobApi | null> | undefined;
let cachedApi: Win32JobApi | null | undefined;

// Koffi 的 struct 注册表是进程级的；Jest --runInBand 会重置模块缓存但不会重置它。
// 每次模块实例化使用唯一后缀，避免重复注册同名 struct。
const STRUCT_SUFFIX = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

/** Load and cache the Win32 bindings. Returns null on non-Windows / load failure. */
async function getApi(): Promise<Win32JobApi | null> {
  if (process.platform !== "win32") return null;
  apiPromise ??= createApi().then((api) => {
    cachedApi = api;
    return api;
  });
  return apiPromise;
}

async function createApi(): Promise<Win32JobApi | null> {
  let koffi: any;
  try {
    const module: any = await import("koffi");
    koffi = module.default ?? module;
  } catch (error: any) {
    logger.warn(
      `Koffi unavailable; Win32 Job Object path disabled: ${error?.message ?? error}`,
    );
    return null;
  }

  try {
    const kernel32 = koffi.load("kernel32.dll");
    const PVOID = koffi.pointer("void");
    const PPVOID = koffi.pointer(PVOID);

    const STARTUPINFOW = koffi.struct(`GUADA_STARTUPINFOW_${STRUCT_SUFFIX}`, {
      cb: "uint32",
      lpReserved: "str16",
      lpDesktop: "str16",
      lpTitle: "str16",
      dwX: "uint32",
      dwY: "uint32",
      dwXSize: "uint32",
      dwYSize: "uint32",
      dwXCountChars: "uint32",
      dwYCountChars: "uint32",
      dwFillAttribute: "uint32",
      dwFlags: "uint32",
      wShowWindow: "uint16",
      cbReserved2: "uint16",
      lpReserved2: koffi.pointer("uint8"),
      hStdInput: PVOID,
      hStdOutput: PVOID,
      hStdError: PVOID,
    });

    const PROCESS_INFORMATION = koffi.struct(
      `GUADA_PROCESS_INFORMATION_${STRUCT_SUFFIX}`,
      {
        hProcess: PVOID,
        hThread: PVOID,
        dwProcessId: "uint32",
        dwThreadId: "uint32",
      },
    );

    const BASIC_LIMIT_INFORMATION = koffi.struct(
      `GUADA_JOBOBJECT_BASIC_LIMIT_INFORMATION_${STRUCT_SUFFIX}`,
      {
        PerProcessUserTimeLimit: "int64",
        PerJobUserTimeLimit: "int64",
        LimitFlags: "uint32",
        MinimumWorkingSetSize: "size_t",
        MaximumWorkingSetSize: "size_t",
        ActiveProcessLimit: "uint32",
        Affinity: "uintptr_t",
        PriorityClass: "uint32",
        SchedulingClass: "uint32",
      },
    );
    const IO_COUNTERS = koffi.struct(`GUADA_IO_COUNTERS_${STRUCT_SUFFIX}`, {
      ReadOperationCount: "uint64",
      WriteOperationCount: "uint64",
      OtherOperationCount: "uint64",
      ReadTransferCount: "uint64",
      WriteTransferCount: "uint64",
      OtherTransferCount: "uint64",
    });
    const EXTENDED_LIMIT_INFORMATION = koffi.struct(
      `GUADA_JOBOBJECT_EXTENDED_LIMIT_INFORMATION_${STRUCT_SUFFIX}`,
      {
        BasicLimitInformation: BASIC_LIMIT_INFORMATION,
        IoInfo: IO_COUNTERS,
        ProcessMemoryLimit: "size_t",
        JobMemoryLimit: "size_t",
        PeakProcessMemoryUsed: "size_t",
        PeakJobMemoryUsed: "size_t",
      },
    );

    const CreateJobObjectW = kernel32.func(
      "__stdcall",
      "CreateJobObjectW",
      PVOID,
      [PVOID, "str16"],
    );
    const SetInformationJobObject = kernel32.func(
      "__stdcall",
      "SetInformationJobObject",
      "int",
      [PVOID, "uint32", koffi.pointer(EXTENDED_LIMIT_INFORMATION), "uint32"],
    );
    const AssignProcessToJobObject = kernel32.func(
      "__stdcall",
      "AssignProcessToJobObject",
      "int",
      [PVOID, PVOID],
    );
    const TerminateJobObject = kernel32.func(
      "__stdcall",
      "TerminateJobObject",
      "int",
      [PVOID, "uint32"],
    );
    const OpenProcess = kernel32.func("__stdcall", "OpenProcess", PVOID, [
      "uint32",
      "int",
      "uint32",
    ]);
    const CloseHandle = kernel32.func("__stdcall", "CloseHandle", "int", [
      PVOID,
    ]);
    const CreateProcessW = kernel32.func("__stdcall", "CreateProcessW", "int", [
      "str16",
      "str16",
      PVOID,
      PVOID,
      "int",
      "uint32",
      PVOID,
      "str16",
      koffi.pointer(STARTUPINFOW),
      koffi.pointer(PROCESS_INFORMATION),
    ]);
    const ResumeThread = kernel32.func("__stdcall", "ResumeThread", "uint32", [
      PVOID,
    ]);
    const WaitForSingleObject = kernel32.func(
      "__stdcall",
      "WaitForSingleObject",
      "uint32",
      [PVOID, "uint32"],
    );
    const GetExitCodeProcess = kernel32.func(
      "__stdcall",
      "GetExitCodeProcess",
      "int",
      [PVOID, PVOID],
    );
    const TerminateProcess = kernel32.func(
      "__stdcall",
      "TerminateProcess",
      "int",
      [PVOID, "uint32"],
    );
    const CreatePipe = kernel32.func("__stdcall", "CreatePipe", "int", [
      PPVOID,
      PPVOID,
      PVOID,
      "uint32",
    ]);
    const SetHandleInformation = kernel32.func(
      "__stdcall",
      "SetHandleInformation",
      "int",
      [PVOID, "uint32", "uint32"],
    );
    const WriteFile = kernel32.func("__stdcall", "WriteFile", "int", [
      PVOID,
      PVOID,
      "uint32",
      PVOID,
      PVOID,
    ]);
    const ReadFile = kernel32.func("__stdcall", "ReadFile", "int", [
      PVOID,
      PVOID,
      "uint32",
      PVOID,
      PVOID,
    ]);
    const PeekNamedPipe = kernel32.func("__stdcall", "PeekNamedPipe", "int", [
      PVOID,
      PVOID,
      "uint32",
      PVOID,
      PVOID,
      PVOID,
    ]);
    const GetLastError = kernel32.func("__stdcall", "GetLastError", "uint32", []);

    const fail = (operation: string): never => {
      throw new Win32JobError(operation, GetLastError());
    };

    const closeHandle = (handle: NativeHandle): void => {
      if (!handle) return;
      try {
        CloseHandle(handle);
      } catch {
        // best-effort cleanup
      }
    };

    return {
      createJobObject(): NativeHandle {
        const job = CreateJobObjectW(null, null);
        if (!job) fail("CreateJobObjectW");
        const limits = {
          BasicLimitInformation: {
            PerProcessUserTimeLimit: 0,
            PerJobUserTimeLimit: 0,
            LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            MinimumWorkingSetSize: 0,
            MaximumWorkingSetSize: 0,
            ActiveProcessLimit: 0,
            Affinity: 0,
            PriorityClass: 0,
            SchedulingClass: 0,
          },
          IoInfo: {
            ReadOperationCount: 0,
            WriteOperationCount: 0,
            OtherOperationCount: 0,
            ReadTransferCount: 0,
            WriteTransferCount: 0,
            OtherTransferCount: 0,
          },
          ProcessMemoryLimit: 0,
          JobMemoryLimit: 0,
          PeakProcessMemoryUsed: 0,
          PeakJobMemoryUsed: 0,
        };
        if (
          !SetInformationJobObject(
            job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            limits,
            koffi.sizeof(EXTENDED_LIMIT_INFORMATION),
          )
        ) {
          const code = GetLastError();
          closeHandle(job);
          throw new Win32JobError("SetInformationJobObject", code);
        }
        return job;
      },

      createStdoutPipe(): { read: NativeHandle; write: NativeHandle } {
        const readSlot = koffi.alloc(PVOID, 1);
        const writeSlot = koffi.alloc(PVOID, 1);
        let read: NativeHandle | null = null;
        let write: NativeHandle | null = null;
        try {
          if (!CreatePipe(readSlot, writeSlot, null, 0)) {
            fail("CreatePipe");
          }
          read = koffi.decode(readSlot, PVOID) as NativeHandle | null;
          write = koffi.decode(writeSlot, PVOID) as NativeHandle | null;
          if (!read || !write) {
            throw new Win32JobError("CreatePipe", 0);
          }
          // Write end goes to the child tree (stdout+stderr share it); the
          // parent keeps the read end. EOF arrives only when every writer in
          // the tree is gone — completion detection never depends on it.
          if (
            !SetHandleInformation(
              write,
              HANDLE_FLAG_INHERIT,
              HANDLE_FLAG_INHERIT,
            )
          ) {
            fail("SetHandleInformation");
          }
          return { read, write };
        } catch (error) {
          if (read) closeHandle(read);
          if (write) closeHandle(write);
          throw error;
        } finally {
          koffi.free(readSlot);
          koffi.free(writeSlot);
        }
      },

      createStdinPipe(): { read: NativeHandle; write: NativeHandle } {
        const readSlot = koffi.alloc(PVOID, 1);
        const writeSlot = koffi.alloc(PVOID, 1);
        let read: NativeHandle | null = null;
        let write: NativeHandle | null = null;
        try {
          if (!CreatePipe(readSlot, writeSlot, null, 0)) {
            fail("CreatePipe");
          }
          read = koffi.decode(readSlot, PVOID) as NativeHandle | null;
          write = koffi.decode(writeSlot, PVOID) as NativeHandle | null;
          if (!read || !write) {
            throw new Win32JobError("CreatePipe", 0);
          }
          if (
            !SetHandleInformation(
              read,
              HANDLE_FLAG_INHERIT,
              HANDLE_FLAG_INHERIT,
            )
          ) {
            fail("SetHandleInformation");
          }
          return { read, write };
        } catch (error) {
          if (read) closeHandle(read);
          if (write) closeHandle(write);
          throw error;
        } finally {
          koffi.free(readSlot);
          koffi.free(writeSlot);
        }
      },

      createProcessSuspended(options): {
        pid: number;
        process: NativeHandle;
        thread: NativeHandle;
      } {
        const environment = buildEnvironmentBlock(options.env);
        const startupInfo = koffi.alloc(STARTUPINFOW, 1);
        const processInfo = koffi.alloc(PROCESS_INFORMATION, 1);
        try {
          koffi.encode(startupInfo, STARTUPINFOW, {
            cb: koffi.sizeof(STARTUPINFOW),
            lpReserved: null,
            lpDesktop: null,
            lpTitle: null,
            dwX: 0,
            dwY: 0,
            dwXSize: 0,
            dwYSize: 0,
            dwXCountChars: 0,
            dwYCountChars: 0,
            dwFillAttribute: 0,
            dwFlags: STARTF_USESTDHANDLES,
            wShowWindow: 0,
            cbReserved2: 0,
            lpReserved2: null,
            hStdInput: options.stdinRead,
            hStdOutput: options.stdoutHandle,
            hStdError: options.stdoutHandle,
          });

          const ok = CreateProcessW(
            options.program,
            options.commandLine,
            null,
            null,
            1,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            koffi.as(environment, "void *"),
            options.cwd,
            startupInfo,
            processInfo,
          );
          if (!ok) fail("CreateProcessW");

          const info = koffi.decode(processInfo, PROCESS_INFORMATION) as {
            hProcess: NativeHandle | null;
            hThread: NativeHandle | null;
            dwProcessId: number;
            dwThreadId: number;
          };
          if (!info.hProcess || !info.hThread) {
            if (info.hProcess) closeHandle(info.hProcess);
            if (info.hThread) closeHandle(info.hThread);
            throw new Win32JobError("CreateProcessW", 0);
          }
          return {
            pid: info.dwProcessId,
            process: info.hProcess,
            thread: info.hThread,
          };
        } finally {
          koffi.free(startupInfo);
          koffi.free(processInfo);
        }
      },

      assignProcessToJob(job: NativeHandle, process: NativeHandle): void {
        if (!AssignProcessToJobObject(job, process)) {
          fail("AssignProcessToJobObject");
        }
      },

      resumeThread(thread: NativeHandle): void {
        if (ResumeThread(thread) === WAIT_FAILED) {
          fail("ResumeThread");
        }
      },

      isProcessExited(process: NativeHandle): boolean {
        const result = WaitForSingleObject(process, 0);
        if (result === WAIT_FAILED) {
          logger.warn(`WaitForSingleObject failed: ${GetLastError()}`);
          return true;
        }
        return result === WAIT_OBJECT_0;
      },

      getExitCode(process: NativeHandle): number {
        const slot = koffi.alloc("uint32", 1);
        try {
          if (!GetExitCodeProcess(process, slot)) {
            fail("GetExitCodeProcess");
          }
          return koffi.decode(slot, "uint32") as number;
        } finally {
          koffi.free(slot);
        }
      },

      writeFile(handle: NativeHandle, data: Buffer): number {
        const writtenSlot = koffi.alloc("uint32", 1);
        try {
          if (!WriteFile(handle, data, data.length, writtenSlot, null)) {
            fail("WriteFile");
          }
          return koffi.decode(writtenSlot, "uint32") as number;
        } finally {
          koffi.free(writtenSlot);
        }
      },

      peekPipe(handle: NativeHandle): number | null {
        const availSlot = koffi.alloc("uint32", 1);
        try {
          if (!PeekNamedPipe(handle, null, 0, null, availSlot, null)) {
            // ERROR_BROKEN_PIPE (109) means every write end is closed → EOF.
            return null;
          }
          return koffi.decode(availSlot, "uint32") as number;
        } finally {
          koffi.free(availSlot);
        }
      },

      readPipe(handle: NativeHandle, buffer: Buffer): number {
        const readSlot = koffi.alloc("uint32", 1);
        try {
          if (!ReadFile(handle, buffer, buffer.length, readSlot, null)) {
            // Broken pipe after a peek is a race with EOF: treat as 0 bytes.
            return 0;
          }
          return koffi.decode(readSlot, "uint32") as number;
        } finally {
          koffi.free(readSlot);
        }
      },

      terminateJob(job: NativeHandle, exitCode: number): void {
        if (!TerminateJobObject(job, exitCode)) {
          fail("TerminateJobObject");
        }
      },

      terminateProcess(process: NativeHandle, exitCode: number): void {
        if (!TerminateProcess(process, exitCode)) {
          fail("TerminateProcess");
        }
      },

      closeHandle,

      lastError(): number {
        return GetLastError();
      },
    };
  } catch (error: any) {
    logger.warn(
      `Win32 Job Object bindings unavailable: ${error?.message ?? error}`,
    );
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Whether the native Windows Job Object path is available in this process. */
export async function isWin32JobAvailable(): Promise<boolean> {
  return (await getApi()) !== null;
}

/**
 * Synchronous pipe read for the cached API (the entry was spawned natively,
 * so the bindings are already loaded). Mirrors writeToProcessStdinSync.
 */
export function peekOutputPipeSync(handle: NativeHandle): number | null {
  if (!cachedApi) throw new Win32JobError("PeekNamedPipe", 0);
  return cachedApi.peekPipe(handle);
}

/** Read up to buffer.length bytes from the output pipe. Non-blocking after a peek. */
export function readOutputPipeSync(
  handle: NativeHandle,
  buffer: Buffer,
): number {
  if (!cachedApi) throw new Win32JobError("ReadFile", 0);
  return cachedApi.readPipe(handle, buffer);
}

/**
 * Create a suspended child, assign it to a kill-on-close Job, then resume it.
 *
 * Returns null when the native path is unavailable (non-Windows / Koffi load
 * failure), so the caller can fall back to Node spawn.
 */
export async function spawnSuspendedInJob(
  options: NativeSpawnOptions,
): Promise<NativeProcessHandle | null> {
  const api = await getApi();
  if (!api) return null;

  const job = api.createJobObject();
  let stdin: { read: NativeHandle; write: NativeHandle } | null = null;
  let output: { read: NativeHandle; write: NativeHandle } | null = null;
  let process: NativeHandle | null = null;
  let thread: NativeHandle | null = null;
  try {
    stdin = api.createStdinPipe();
    output = api.createStdoutPipe();
    const created = api.createProcessSuspended({
      program: options.program,
      commandLine: buildCommandLine(options.program, options.args),
      cwd: options.cwd,
      env: options.env,
      stdinRead: stdin.read,
      stdoutHandle: output.write,
    });
    process = created.process;
    thread = created.thread;

    api.assignProcessToJob(job, process);
    api.resumeThread(thread);
    api.closeHandle(thread);
    thread = null;
    api.closeHandle(stdin.read);
    stdin.read = 0n;
    // The child owns the write end now; the parent must not hold a second
    // copy or the read end would never see EOF.
    api.closeHandle(output.write);
    output.write = 0n;

    return {
      pid: created.pid,
      process,
      job,
      stdinWrite: stdin.write,
      outputRead: output.read,
    };
  } catch (error) {
    if (thread) api.closeHandle(thread);
    if (process) {
      try {
        api.terminateProcess(process, 1);
      } catch {
        // ignore
      }
      api.closeHandle(process);
    }
    if (stdin) {
      api.closeHandle(stdin.read);
      api.closeHandle(stdin.write);
    }
    if (output) {
      api.closeHandle(output.read);
      api.closeHandle(output.write);
    }
    api.closeHandle(job);
    throw error;
  }
}

/** Wait until the direct child exits (polling) or the timeout elapses. */
export async function waitForProcessExit(
  process: NativeHandle,
  timeoutMs: number,
): Promise<boolean> {
  const api = await getApi();
  if (!api) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (api.isProcessExited(process)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return api.isProcessExited(process);
}

/** Whether the direct child has exited. */
export async function isProcessExited(process: NativeHandle): Promise<boolean> {
  const api = await getApi();
  return api ? api.isProcessExited(process) : true;
}

/** Exit code of the direct child. Call only after it has exited. */
export async function getProcessExitCode(process: NativeHandle): Promise<number> {
  const api = await getApi();
  if (!api) throw new Win32JobError("GetExitCodeProcess", 0);
  return api.getExitCode(process);
}

/** Write UTF-8 bytes to the child's stdin pipe. */
export async function writeToProcessStdin(
  handle: NativeHandle,
  text: string,
): Promise<number> {
  const api = await getApi();
  if (!api) throw new Win32JobError("WriteFile", 0);
  return api.writeFile(handle, Buffer.from(text, "utf8"));
}

/**
 * 同步写 stdin（WorkspaceProvider 的 writeToStdin 是同步签名）。
 * 进程既然是通过 native 路径创建的，API 必然已经缓存。
 */
export function writeToProcessStdinSync(
  handle: NativeHandle,
  text: string,
): number {
  if (!cachedApi) throw new Win32JobError("WriteFile", 0);
  return cachedApi.writeFile(handle, Buffer.from(text, "utf8"));
}

/** Terminate every process in the Job. */
export async function terminateJob(
  job: NativeHandle,
  exitCode = 1,
): Promise<void> {
  const api = await getApi();
  if (!api) return;
  api.terminateJob(job, exitCode);
}

/** Terminate the direct child only (fallback when Job termination fails). */
export async function terminateProcess(
  process: NativeHandle,
  exitCode = 1,
): Promise<void> {
  const api = await getApi();
  if (!api) return;
  api.terminateProcess(process, exitCode);
}

/** Best-effort CloseHandle. */
export async function closeNativeHandle(handle: NativeHandle): Promise<void> {
  const api = await getApi();
  if (!api) return;
  api.closeHandle(handle);
}
