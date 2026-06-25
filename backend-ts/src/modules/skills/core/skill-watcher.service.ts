import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as path from "path";
import * as chokidar from "chokidar";
import { SkillDiscoveryService } from "./skill-discovery.service";
import { SkillLoaderService } from "./skill-loader.service";
import { SkillRegistry } from "./skill-registry.service";

@Injectable()
export class SkillWatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(SkillWatcherService.name);
  private readonly skillsDir: string;
  private readonly systemSkillsDir: string;
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private configService: ConfigService,
    private discoveryService: SkillDiscoveryService,
    private loader: SkillLoaderService,
    private registry: SkillRegistry,
  ) {
    this.skillsDir =
      this.configService.get<string>("SKILLS_DIR") ||
      path.join(process.cwd(), "skills");
    this.systemSkillsDir = path.join(this.skillsDir, ".system");
  }

  start(): void {
    if (this.watcher) {
      this.logger.warn("Watcher already started, ignoring");
      return;
    }

    const targets = new Set<string>();
    targets.add(this.skillsDir + "/*/SKILL.md");
    targets.add(this.systemSkillsDir + "/*/SKILL.md");

    const patterns = Array.from(targets);
    this.logger.log(
      "Starting skills file watcher on patterns: " + patterns.join(", "),
    );

    this.watcher = chokidar.watch(patterns, {
      ignoreInitial: true,
      ignorePermissionErrors: true,
      persistent: true,
    });

    this.watcher
      .on("add", (filePath: string) => this.handleAdd(filePath))
      .on("change", (filePath: string) => this.handleChange(filePath))
      .on("unlink", (filePath: string) => this.handleUnlink(filePath))
      .on("error", (err: unknown) =>
        this.logger.error("Watcher error: " + String(err)),
      );
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.logger.log("Skills file watcher stopped");
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  private skillIdFromPath(
    filePath: string,
  ): { id: string; basePath: string } | null {
    const dir = path.dirname(filePath);
    const dirName = path.basename(dir);
    if (dirName.startsWith(".")) return null;
    return {
      id: dirName.toLowerCase(),
      basePath: dir,
    };
  }

  private debounced(key: string, fn: () => Promise<void>, ms = 300): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(async () => {
        this.debounceTimers.delete(key);
        try {
          await fn();
        } catch (error: any) {
          this.logger.error(
            "Watcher handler error for " + key + ": " + error.message,
          );
        }
      }, ms),
    );
  }

  private async handleAdd(filePath: string): Promise<void> {
    const info = this.skillIdFromPath(filePath);
    if (!info) return;

    this.debounced("add:" + info.id, async () => {
      this.logger.log("New skill detected: " + info.id);
      try {
        const skillDef = await this.loader.loadManifest(
          info.basePath,
          "global",
        );
        this.registry.register(skillDef);
        this.logger.log("Skill registered: " + skillDef.manifest.name);
      } catch (error: any) {
        this.logger.warn(
          "Failed to load new skill " + info.id + ": " + error.message,
        );
      }
    });
  }

  private async handleChange(filePath: string): Promise<void> {
    const info = this.skillIdFromPath(filePath);
    if (!info) return;

    this.debounced("change:" + info.id, async () => {
      const existing = this.registry.get(info.id);
      if (!existing) {
        this.logger.log("Unknown skill changed, treating as new: " + info.id);
        return this.handleAdd(filePath);
      }

      this.logger.log("Skill changed: " + info.id);
      try {
        const updatedDef = await this.loader.reloadManifest(existing);
        this.registry.update(updatedDef);
        this.logger.log("Skill updated: " + updatedDef.manifest.name);
      } catch (error: any) {
        this.logger.warn(
          "Failed to reload skill " + info.id + ": " + error.message,
        );
      }
    });
  }

  private async handleUnlink(filePath: string): Promise<void> {
    const info = this.skillIdFromPath(filePath);
    if (!info) return;

    this.debounced("unlink:" + info.id, async () => {
      this.logger.log("Skill removed: " + info.id);
      this.registry.unregister(info.id);
    });
  }
}
