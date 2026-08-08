import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import {
  WorkspaceProvider,
  WorkspaceProviderFactory,
  ParsedWorkspaceUri,
  parseWorkspacePath,
} from "./workspace-provider.interface";
import { LocalWorkspaceProvider } from "./local-workspace-provider";
import { PluginRegistry } from "../../modules/plugins/registry/plugin-registry";

interface CachedProvider {
  provider: WorkspaceProvider;
  activeOps: number;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * WorkspaceProviderResolver — routes workspace operations to the correct provider.
 *
 * Routing is driven by URI scheme in `session.workspacePath`:
 * - No scheme prefix (e.g. `D:/projects`, `/home/user`) → LocalWorkspaceProvider (not cached)
 * - `ssh://user@host:22/path` → SshWorkspaceProvider (cached, lazy init, idle timeout)
 *
 * Connection lifecycle:
 * - Lazy init: first resolve() creates and connects the provider
 * - Idle timeout: 5 minutes of inactivity auto-disconnects (activeOps=0)
 * - activeOps counter: operations in progress prevent timeout
 * - Local scheme: no caching (zero connection overhead)
 */
@Injectable()
export class WorkspaceProviderResolver implements OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceProviderResolver.name);
  private readonly cache = new Map<string, CachedProvider>();
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;

  /** Built-in local factory — always available, no plugin registration needed */
  private readonly localFactory: WorkspaceProviderFactory = {
    scheme: "local",
    label: "本地",
    configSchema: [],
    create: (uri: ParsedWorkspaceUri) => {
      // LocalWorkspaceProvider is injected via DI, reused for all local sessions
      return this.localProvider;
    },
    makeCacheKey: () => "local",
  };

  constructor(private readonly localProvider: LocalWorkspaceProvider) {}

  /**
   * Resolve a WorkspaceProvider for the given workspacePath.
   *
   * For local paths: returns the singleton LocalWorkspaceProvider (no caching).
   * For remote schemes: creates/caches a provider with lazy init + idle timeout.
   */
  async resolve(workspacePath: string): Promise<WorkspaceProvider> {
    const uri = parseWorkspacePath(workspacePath);

    // Local: no caching, no connection overhead
    if (uri.scheme === "local") {
      return this.localProvider;
    }

    // Remote: look up factory from PluginRegistry
    const factory = PluginRegistry.findWorkspaceProviderFactory(uri.scheme);
    if (!factory) {
      throw new Error(
        `No workspace provider registered for scheme: '${uri.scheme}'. ` +
          `Ensure the corresponding plugin is installed and enabled.`,
      );
    }

    const cacheKey = factory.makeCacheKey(uri);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      this.resetIdleTimer(cacheKey, cached);
      return cached.provider;
    }

    // First connection — lazy init
    const provider = factory.create(uri);
    await provider.connect();
    const entry: CachedProvider = { provider, activeOps: 0, idleTimer: null };
    this.cache.set(cacheKey, entry);
    this.resetIdleTimer(cacheKey, entry);

    this.logger.log(
      `WorkspaceProvider connected: ${uri.scheme} (${cacheKey})`,
    );
    return provider;
  }

  /**
   * Wrap an operation with activeOps tracking.
   *
   * Prevents idle timeout from firing during an in-progress operation.
   * Resets the idle timer when the operation completes.
   */
  async withProvider<T>(
    workspacePath: string,
    fn: (provider: WorkspaceProvider) => Promise<T>,
  ): Promise<T> {
    const uri = parseWorkspacePath(workspacePath);

    // Local: no tracking needed
    if (uri.scheme === "local") {
      return fn(this.localProvider);
    }

    const factory = PluginRegistry.findWorkspaceProviderFactory(uri.scheme);
    if (!factory) {
      throw new Error(
        `No workspace provider registered for scheme: '${uri.scheme}'.`,
      );
    }

    const cacheKey = factory.makeCacheKey(uri);
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      // Provider not connected — resolve first (will create + cache)
      await this.resolve(workspacePath);
    }

    const cached = this.cache.get(cacheKey)!;
    cached.activeOps++;
    this.clearIdleTimer(cached);

    try {
      return await fn(cached.provider);
    } finally {
      cached.activeOps--;
      if (cached.activeOps === 0) {
        this.resetIdleTimer(cacheKey, cached);
      }
    }
  }

  /**
   * Get the built-in local factory (used by workspace-connections controller).
   */
  getLocalFactory(): WorkspaceProviderFactory {
    return this.localFactory;
  }

  /**
   * Get all registered factories (built-in + plugins).
   */
  getAllFactories(): WorkspaceProviderFactory[] {
    const pluginFactories: WorkspaceProviderFactory[] = [];
    for (const pluginId of PluginRegistry.getAllIds()) {
      const regs = PluginRegistry.getWorkspaceProviders(pluginId);
      pluginFactories.push(...regs);
    }
    return [this.localFactory, ...pluginFactories];
  }

  private resetIdleTimer(cacheKey: string, entry: CachedProvider): void {
    this.clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      if (entry.activeOps === 0) {
        entry.provider
          .disconnect()
          .catch((err) =>
            this.logger.warn(
              `Provider disconnect failed for ${cacheKey}: ${err.message}`,
            ),
          );
        this.cache.delete(cacheKey);
        this.logger.log(`WorkspaceProvider idle-disconnected: ${cacheKey}`);
      }
    }, this.IDLE_TIMEOUT_MS);
    entry.idleTimer.unref?.();
  }

  private clearIdleTimer(entry: CachedProvider): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const [key, entry] of this.cache) {
      this.clearIdleTimer(entry);
      await entry.provider.disconnect().catch(() => {});
      this.logger.log(`WorkspaceProvider disconnected on destroy: ${key}`);
    }
    this.cache.clear();
  }
}
