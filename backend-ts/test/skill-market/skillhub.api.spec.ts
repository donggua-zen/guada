/// <reference types="jest" />

import {
  buildCategoriesUrl,
  buildSkillDetailUrl,
  buildSkillDownloadUrl,
  buildSkillEvaluationUrl,
  buildSkillListUrl,
  buildSkillTopUrl,
  normalizeSlug,
  parseCategoriesResponse,
  parseEvaluationResponse,
  parseSkillDetailResponse,
  parseSkillListResponse,
  parseSkillTopResponse,
  pickRandom,
} from "../../src/modules/skill-market/skillhub.api";

describe("skillhub.api", () => {
  describe("normalizeSlug", () => {
    it("接受常见 slug", () => {
      expect(normalizeSlug("pdf-image-text-extractor")).toBe("pdf-image-text-extractor");
      expect(normalizeSlug("find-skill-skillhub")).toBe("find-skill-skillhub");
      expect(normalizeSlug("a.b_c-1")).toBe("a.b_c-1");
    });

    it("拒绝空值、路径片段与注入字符", () => {
      expect(normalizeSlug("")).toBeNull();
      expect(normalizeSlug("../etc/passwd")).toBeNull();
      expect(normalizeSlug("a/b")).toBeNull();
      expect(normalizeSlug("a?b=1")).toBeNull();
      expect(normalizeSlug(123)).toBeNull();
    });
  });

  describe("URL 构造", () => {
    it("列表 URL 携带分页/关键词/分类/排序", () => {
      const url = buildSkillListUrl({
        page: 2,
        pageSize: 12,
        keyword: "pdf",
        category: "office-efficiency",
        sortBy: "score",
        order: "desc",
      });
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://api.skillhub.cn");
      expect(parsed.pathname).toBe("/api/skills");
      expect(parsed.searchParams.get("page")).toBe("2");
      expect(parsed.searchParams.get("pageSize")).toBe("12");
      expect(parsed.searchParams.get("keyword")).toBe("pdf");
      expect(parsed.searchParams.get("category")).toBe("office-efficiency");
      expect(parsed.searchParams.get("sortBy")).toBe("score");
      expect(parsed.searchParams.get("order")).toBe("desc");
    });

    it("详情/评测/下载 URL 对 slug 做编码", () => {
      expect(buildSkillDetailUrl("a b")).toContain("/api/v1/skills/a%20b");
      expect(buildSkillEvaluationUrl("a b")).toContain("/api/v1/skills/a%20b/evaluation");
      expect(buildSkillDownloadUrl("a b", "1.0.0")).toContain(
        "/api/v1/download?slug=a+b&version=1.0.0",
      );
      expect(buildSkillTopUrl()).toBe("https://api.skillhub.cn/api/skills/top");
      expect(buildCategoriesUrl()).toBe("https://api.skillhub.cn/api/v1/categories");
    });
  });

  describe("parseSkillListResponse", () => {
    const body = {
      code: 0,
      message: "success",
      data: {
        total: 5038,
        skills: [
          {
            slug: "pdf-image-text-extractor",
            name: "PDF和图片文字提取",
            description: "Extract text from PDF",
            description_zh: "从 PDF 中提取文字",
            iconUrl: "https://cloudcache.tencent-cloud.com/icon.png",
            version: "1.0.13",
            category: "office-efficiency",
            subCategories: [{ key: "office-pdf", name: "PDF 处理" }],
            labels: { requires_api_key: "true" },
            downloads: 335864,
            stars: 191,
            installs: 378,
            verified: false,
            source: "community",
            updated_at: 1793627201970,
          },
        ],
      },
    };

    it("归一化字段并按语言选描述", () => {
      const result = parseSkillListResponse(body, { lang: "zh", page: 1, pageSize: 12 });

      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 12,
        total: 5038,
        totalPages: 420,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        source: "skillhub",
        id: "pdf-image-text-extractor",
        name: "PDF和图片文字提取",
        description: "从 PDF 中提取文字",
        version: "1.0.13",
        category: { key: "office-efficiency" },
        stats: { downloads: 335864, stars: 191, installs: 378 },
        sourceType: "community",
        detailUrl: "https://skillhub.cn/skills/pdf-image-text-extractor",
      });
      expect(result.items[0].labels).toEqual({ requires_api_key: "true" });
      expect(result.items[0].subCategories).toEqual([{ key: "office-pdf", name: "PDF 处理" }]);
    });

    it("英文请求优先英文描述", () => {
      const result = parseSkillListResponse(body, { lang: "en", page: 1, pageSize: 12 });
      expect(result.items[0].description).toBe("Extract text from PDF");
    });

    it("中文缺失时回退英文，反之亦然", () => {
      const enOnly = {
        data: {
          total: 1,
          skills: [{ slug: "en-only", name: "EN", description: "English only" }],
        },
      };
      expect(
        parseSkillListResponse(enOnly, { lang: "zh", page: 1, pageSize: 12 }).items[0]
          .description,
      ).toBe("English only");

      const zhOnly = {
        data: {
          total: 1,
          skills: [{ slug: "zh-only", name: "ZH", description_zh: "只有中文" }],
        },
      };
      expect(
        parseSkillListResponse(zhOnly, { lang: "en", page: 1, pageSize: 12 }).items[0]
          .description,
      ).toBe("只有中文");
    });

    it("跳过非法 slug，缺 total 时用条目数", () => {
      const result = parseSkillListResponse(
        {
          data: {
            skills: [
              { slug: "../evil", name: "bad" },
              { slug: "good-skill", name: "Good" },
            ],
          },
        },
        { lang: "zh", page: 1, pageSize: 10 },
      );
      expect(result.items.map((item) => item.id)).toEqual(["good-skill"]);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("code 非 0 时抛出上游 message", () => {
      expect(() =>
        parseSkillListResponse(
          { code: 429, message: "too many requests", data: { skills: [] } },
          { lang: "zh", page: 1, pageSize: 12 },
        ),
      ).toThrow("too many requests");
    });

    it("按 slug 去重（上游会重复返回同一技能）", () => {
      const result = parseSkillListResponse(
        {
          data: {
            total: 3,
            skills: [
              { slug: "wps-office-suite", name: "WPS Office 全家桶" },
              { slug: "wps-office-suite", name: "WPS Office 全家桶" },
              { slug: "other", name: "Other" },
              { slug: "wps-office-suite", name: "WPS Office 全家桶" },
            ],
          },
        },
        { lang: "zh", page: 1, pageSize: 12 },
      );

      expect(result.items.map((item) => item.id)).toEqual(["wps-office-suite", "other"]);
      // total 仍是上游口径，不做二次推断
      expect(result.pagination.total).toBe(3);
    });
  });

  describe("parseSkillTopResponse / pickRandom", () => {
    const body = {
      code: 0,
      data: {
        total: 2,
        skills: [
          { slug: "a", name: "A" },
          { slug: "b", name: "B" },
        ],
      },
    };

    it("解析 Top 榜条目", () => {
      expect(parseSkillTopResponse(body, "zh").map((item) => item.id)).toEqual(["a", "b"]);
    });

    it("Top 榜按 slug 去重", () => {
      const duplicated = {
        data: {
          total: 4,
          skills: [
            { slug: "wps", name: "WPS" },
            { slug: "wps", name: "WPS" },
            { slug: "dev", name: "Dev" },
            { slug: "wps", name: "WPS" },
          ],
        },
      };

      expect(parseSkillTopResponse(duplicated, "zh").map((item) => item.id)).toEqual([
        "wps",
        "dev",
      ]);
    });

    it("随机取 N 条不重复；random=0 时保持前 N 条", () => {
      const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
      expect(pickRandom(items, 2, () => 0)).toEqual([{ id: "a" }, { id: "b" }]);
      expect(pickRandom(items, 10, () => 0.9)).toHaveLength(3);
      expect(new Set(pickRandom(items, 3, () => 0.5).map((item) => item.id)).size).toBe(3);
    });
  });

  describe("parseCategoriesResponse", () => {
    it("过滤未激活与 pay-skill，并按 sortOrder 排序", () => {
      const categories = parseCategoriesResponse(
        {
          items: [
            { key: "pay-skill", name: "Pay Skill", nameEn: "Pay Skill", sortOrder: 0, active: true },
            { key: "dev-programming", name: "开发编程", nameEn: "Development", sortOrder: 30 },
            { key: "office-efficiency", name: "办公效率", nameEn: "Office Efficiency", sortOrder: 10 },
            { key: "hidden", name: "Hidden", nameEn: "Hidden", sortOrder: 20, active: false },
          ],
        },
        "zh",
      );

      expect(categories.map((category) => category.id)).toEqual([
        "office-efficiency",
        "dev-programming",
      ]);
      expect(categories[0].name).toBe("办公效率");
      expect(categories[0].nameI18n).toEqual({
        zh: "办公效率",
        en: "Office Efficiency",
      });
    });

    it("英文请求选 nameEn", () => {
      const categories = parseCategoriesResponse(
        {
          items: [
            { key: "dev-programming", name: "开发编程", nameEn: "Development", sortOrder: 30 },
          ],
        },
        "en",
      );
      expect(categories[0].name).toBe("Development");
    });
  });

  describe("parseSkillDetailResponse", () => {
    it("解析作者/最新版本/安全报告", () => {
      const detail = parseSkillDetailResponse(
        {
          slug: "pdf-image-text-extractor",
          skill: {
            slug: "pdf-image-text-extractor",
            category: "office-efficiency",
            source: "community",
            iconUrl: "https://example.com/icon.png",
            displayName: "PDF和图片文字提取",
            summary: "Extract text",
            summary_zh: "提取文字",
            tags: { latest: "1.0.13" },
            stats: { downloads: 335864, stars: 191, installs: 378, versions: 14 },
            updatedAt: 1793627373854,
            labels: { requires_api_key: "true" },
          },
          latestVersion: {
            version: "1.0.13",
            createdAt: 1788937092305,
            changelog: "优化文案",
          },
          owner: {
            handle: "user_5f9c21aa",
            displayName: "to the moon",
            image: null,
          },
          securityReports: {
            keen: {
              status: "benign",
              statusText: "安全，无风险",
              reportUrl: "https://tix.qq.com/search/skill?keyword=abc",
            },
          },
        },
        "zh",
      );

      expect(detail.item).toMatchObject({
        id: "pdf-image-text-extractor",
        name: "PDF和图片文字提取",
        version: "1.0.13",
        description: "提取文字",
        stats: { downloads: 335864, stars: 191, installs: 378 },
      });
      expect(detail.owner?.displayName).toBe("to the moon");
      expect(detail.latestVersion).toMatchObject({ version: "1.0.13", changelog: "优化文案" });
      expect(detail.securityReports).toEqual([
        {
          provider: "keen",
          status: "benign",
          statusText: "安全，无风险",
          reportUrl: "https://tix.qq.com/search/skill?keyword=abc",
        },
      ]);
      expect(detail.evaluation).toBeNull();
    });

    it("缺少 slug 时抛错", () => {
      expect(() => parseSkillDetailResponse({ skill: { name: "x" } }, "zh")).toThrow(
        "缺少 slug",
      );
    });
  });

  describe("parseEvaluationResponse", () => {
    it("按维度子项均分，再按五维取总分", () => {
      const evaluation = parseEvaluationResponse({
        dimensions: {
          trust: {
            userReason: "来源可核验",
            items: {
              scan: { score: 4.5 },
              domestic: { score: 4.0 },
            },
          },
          reliability: {
            items: {
              stability: { score: 4.2 },
              func: { score: 4.0 },
              errorHandling: { score: 3.5 },
            },
          },
          adaptability: { items: {} },
          convention: { items: {} },
          effectiveness: { items: {} },
        },
        userSummary: "整体质量良好",
        updatedAt: 1773850000000,
      });

      expect(evaluation).not.toBeNull();
      const trust = evaluation!.dimensions.find((dimension) => dimension.key === "trust");
      const reliability = evaluation!.dimensions.find(
        (dimension) => dimension.key === "reliability",
      );

      expect(trust?.score).toBe(4.3);
      expect(trust?.userReason).toBe("来源可核验");
      expect(reliability?.score).toBe(3.9);
      // (4.3 + 3.9 + 0 + 0 + 0) / 5 = 1.64 → 1.6
      expect(evaluation!.totalScore).toBe(1.6);
      expect(evaluation!.userSummary).toBe("整体质量良好");
    });

    it("没有可用分数时总分为 null", () => {
      const evaluation = parseEvaluationResponse({
        dimensions: {
          trust: { items: { scan: { score: null } } },
        },
      });
      expect(evaluation).not.toBeNull();
      expect(evaluation!.totalScore).toBeNull();
      expect(evaluation!.dimensions.find((dimension) => dimension.key === "trust")?.score).toBeNull();
    });

    it("非对象/无 dimensions 返回 null", () => {
      expect(parseEvaluationResponse(null)).toBeNull();
      expect(parseEvaluationResponse({})).toBeNull();
    });
  });
});
