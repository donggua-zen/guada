/// <reference types="jest" />

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import AdmZip from "adm-zip";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  fetchMarketBinary,
  fetchMarketJson,
  SKILLHUB_DOWNLOAD_HOST_POLICY,
} from "../../src/common/http/market-http.client";
import { SkillHubMarketService } from "../../src/modules/skill-market/skillhub-market.service";
import {
  buildSkillDetailUrl,
  buildSkillDownloadUrl,
} from "../../src/modules/skill-market/skillhub.api";
import { SkillLoaderService } from "../../src/modules/skills/core/skill-loader.service";
import { SkillOrchestrator } from "../../src/modules/skills/core/skill-orchestrator.service";
import { SKILL_ORIGIN_FILE } from "../../src/modules/skills/core/skill-package.installer";

jest.mock("../../src/common/http/market-http.client", () => ({
  ...jest.requireActual("../../src/common/http/market-http.client"),
  fetchMarketBinary: jest.fn(),
  fetchMarketJson: jest.fn(),
}));

// Importing the real orchestrator pulls in native dependencies unrelated to installation.
jest.mock("../../src/modules/skills/core/skill-orchestrator.service", () => ({
  SkillOrchestrator: jest.fn(),
}));

// Keep the service's extraction directory inside backend-ts/temp as well.
jest.mock("os", () => ({
  ...jest.requireActual("os"),
  tmpdir: jest.fn(),
}));

const fetchBinaryMock = jest.mocked(fetchMarketBinary);
const fetchJsonMock = jest.mocked(fetchMarketJson);
const tmpdirMock = jest.mocked(os.tmpdir);
const tempParent = path.resolve(__dirname, "../../temp");
const slug = "market-icon-fixture";
const version = "1.2.3";
const iconUrl = "https://cloudcache.tencent-cloud.com/skillhub/market-icon.png";
const apiKey = "install-test-api-key";
const skillMarkdown = `---\nname: ${slug}\ndescription: A fixture for market installation tests.\nversion: ${version}\n---\n\n# Market icon fixture\n`;

function createSkillZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${slug}/SKILL.md`, Buffer.from(skillMarkdown));
  zip.addFile(`${slug}/references/example.txt`, Buffer.from("Installed from the ZIP fixture.\n"));
  return zip.toBuffer();
}

describe("SkillHubMarketService.install market icon", () => {
  let tempRoot: string;
  let skillsDir: string;
  let service: SkillHubMarketService;
  let triggerScan: jest.Mock;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    fetchBinaryMock.mockReset();
    fetchJsonMock.mockReset();
    await fs.mkdir(tempParent, { recursive: true });
    tempRoot = await fs.mkdtemp(path.join(tempParent, "skillhub-market-install-"));
    skillsDir = path.join(tempRoot, "skills");
    tmpdirMock.mockReturnValue(tempRoot);
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    const configValues: Record<string, string> = {
      SKILLS_DIR: skillsDir,
      SKILLHUB_API_KEY: `  ${apiKey}  `,
    };
    const config = {
      get: (key: string) => configValues[key],
    } as unknown as ConfigService;
    triggerScan = jest.fn().mockResolvedValue(undefined);
    service = new SkillHubMarketService(
      config,
      { triggerScan } as unknown as SkillOrchestrator,
    );
    fetchBinaryMock.mockResolvedValue({
      buffer: createSkillZip(),
      contentType: "application/zip",
      finalUrl: buildSkillDownloadUrl(slug, version),
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    tmpdirMock.mockReset();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  async function expectInstalled(expectedIcon?: string): Promise<void> {
    const result = await service.install({ slug, version });
    const expectedOrigin = {
      source: "skillhub",
      itemId: slug,
      version,
      ...(expectedIcon ? { iconUrl: expectedIcon } : {}),
    };

    expect(result).toMatchObject({ success: true, skillIds: [slug] });
    expect(result.origin).toEqual(expectedOrigin);
    expect(triggerScan).toHaveBeenCalledTimes(1);
    expect(fetchBinaryMock).toHaveBeenCalledTimes(1);
    expect(fetchBinaryMock).toHaveBeenCalledWith(buildSkillDownloadUrl(slug, version), {
      policy: SKILLHUB_DOWNLOAD_HOST_POLICY,
      requireZip: true,
      timeoutMs: 120_000,
      maxBytes: 50 * 1024 * 1024,
    });
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchJsonMock).toHaveBeenCalledWith(buildSkillDetailUrl(slug), undefined, {
      "X-API-Key": apiKey,
    });
    expect(fetchBinaryMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchJsonMock.mock.invocationCallOrder[0],
    );

    // Use the real extractor and installSkillsFromDirectory, then read their files.
    const skillDir = path.join(skillsDir, slug);
    expect(await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8")).toBe(skillMarkdown);
    expect(await fs.readFile(path.join(skillDir, "references/example.txt"), "utf-8")).toBe(
      "Installed from the ZIP fixture.\n",
    );
    const sidecar = JSON.parse(await fs.readFile(path.join(skillDir, SKILL_ORIGIN_FILE), "utf-8"));
    expect(sidecar).toEqual({
      schemaVersion: 1,
      ...expectedOrigin,
      installedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(sidecar.installedAt))).toBe(false);

    const definition = await new SkillLoaderService().loadManifest(skillDir, "global", skillsDir);
    expect(definition.id).toBe(slug);
    expect(definition.origin).toEqual({
      ...expectedOrigin,
      installedAt: sidecar.installedAt,
    });
    if (!expectedIcon) {
      expect(result.origin).not.toHaveProperty("iconUrl");
      expect(sidecar).not.toHaveProperty("iconUrl");
      expect(definition.origin).not.toHaveProperty("iconUrl");
    }

    // Installation's temporary ZIP/extraction directory is removed by finally.
    expect(await fs.readdir(tempRoot)).toEqual(["skills"]);
    expect(await fs.readdir(skillsDir)).toEqual([slug]);
  }

  it("persists the market detail icon in the sidecar and exposes it through loadManifest", async () => {
    fetchJsonMock.mockResolvedValue({
      skill: { slug, displayName: "Market icon fixture", iconUrl },
    });

    await expectInstalled(iconUrl);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("still installs and scans without an icon when the detail request fails", async () => {
    fetchJsonMock.mockRejectedValue(new Error("market detail unavailable"));

    await expectInstalled();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("market detail unavailable"));
  });

  it("still installs without an icon when a successful detail response has no icon", async () => {
    fetchJsonMock.mockResolvedValue({
      skill: { slug, displayName: "Market icon fixture" },
    });

    await expectInstalled();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("still installs and only warns when the detail response cannot be parsed", async () => {
    fetchJsonMock.mockResolvedValue({ skill: { displayName: "Missing slug" } });

    await expectInstalled();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("缺少 slug"));
  });
});
