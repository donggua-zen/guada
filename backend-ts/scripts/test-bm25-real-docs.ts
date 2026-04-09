/**
 * 真实文档 BM25 对比测试 - TypeScript 端
 * 
 * 加载 backend/docs 目录下的 Markdown 文件进行测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { Jieba } from '@node-rs/jieba';

interface Document {
  path: string;
  content: string;
  originalLength: number;
  textLength: number;
}

interface QueryInfo {
  name: string;
  query: string;
  keywords: string[];
}

interface SearchResult {
  index: number;
  path: string;
  score: number;
  preview: string;
  rank?: number;
}

interface QueryResult {
  query_name: string;
  query: string;
  keywords: string[];
  total_docs: number;
  matched_docs: number;
  top_results: SearchResult[];
}

class RealDocumentLoader {
  private docsDir: string;

  constructor(docsDir: string) {
    this.docsDir = docsDir;
  }

  /**
   * 加载 Markdown 文件
   */
  loadMarkdownFiles(maxFiles: number = 20): Document[] {
    console.log(`从 ${this.docsDir} 加载 Markdown 文件...`);

    const mdFiles: string[] = [];
    this.walkDir(this.docsDir, mdFiles, maxFiles);

    console.log(`找到 ${mdFiles.length} 个 Markdown 文件`);

    const documents: Document[] = [];
    for (const filePath of mdFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const textContent = this.extractText(content);

        if (textContent.length > 50) {
          const relPath = path.relative(this.docsDir, filePath);
          documents.push({
            path: relPath,
            content: textContent,
            originalLength: content.length,
            textLength: textContent.length,
          });
        }
      } catch (e: any) {
        console.warn(`读取文件失败 ${filePath}: ${e.message}`);
      }
    }

    console.log(`成功加载 ${documents.length} 个文档`);
    return documents;
  }

  /**
   * 递归遍历目录
   */
  private walkDir(dir: string, files: string[], maxFiles: number): void {
    if (files.length >= maxFiles) return;

    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (files.length >= maxFiles) break;

      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        this.walkDir(fullPath, files, maxFiles);
      } else if (item.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  /**
   * 从 Markdown 提取纯文本
   */
  private extractText(markdownContent: string): string {
    let text = markdownContent;

    // 移除代码块
    text = text.replace(/```[\s\S]*?```/g, '');

    // 移除行内代码
    text = text.replace(/`[^`]+`/g, '');

    // 移除图片
    text = text.replace(/!\[.*?\]\(.*?\)/g, '');

    // 移除链接，保留文本
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // 移除标题标记
    text = text.replace(/^#{1,6}\s+/gm, '');

    // 移除列表标记
    text = text.replace(/^[\-\*\+]\s+/gm, '');
    text = text.replace(/^\d+\.\s+/gm, '');

    // 移除粗体和斜体标记
    text = text.replace(/\*\*(.+?)\*\*/g, '$1');
    text = text.replace(/\*(.+?)\*/g, '$1');
    text = text.replace(/__(.+?)__/g, '$1');
    text = text.replace(/_(.+?)_/g, '$1');

    // 移除水平线
    text = text.replace(/^[\-\*_]{3,}$/gm, '');

    // 清理多余空白
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/ {2,}/g, ' ');

    return text.trim();
  }
}

class BM25Calculator {
  private jieba: Jieba;

  constructor() {
    this.jieba = new Jieba();
  }

  /**
   * 智能分词
   */
  private tokenize(text: string): string[] {
    const hasChinese = /[\u4e00-\u9fff]/.test(text);

    if (hasChinese) {
      const tokens = this.jieba.cut(text, true);
      return tokens.map(t => /^[a-zA-Z0-9]+$/.test(t) ? t.toLowerCase() : t);
    } else {
      return text.toLowerCase().split(/\s+/).filter(t => t);
    }
  }

  /**
   * 计算文档频率 (DF)
   */
  private calculateDocumentFrequency(corpus: string[][], term: string): number {
    let df = 0;
    for (const doc of corpus) {
      if (doc.includes(term)) {
        df++;
      }
    }
    return df;
  }

  /**
   * 计算词频 (TF)
   */
  private calculateTermFrequency(doc: string[], term: string): number {
    return doc.filter(t => t === term).length;
  }

  /**
   * 实现 Okapi BM25 算法
   */
  calculateBM25Scores(
    query: string,
    documents: string[],
    k1: number = 1.2,
    b: number = 0.75
  ): number[] {
    if (documents.length === 0) return [];

    // 1. 分词
    const corpus = documents.map(doc => this.tokenize(doc));
    const queryTokens = this.tokenize(query);

    // 2. 计算平均文档长度
    const docLengths = corpus.map(doc => doc.length);
    const avgDocLength = docLengths.reduce((sum, len) => sum + len, 0) / corpus.length;

    // 3. 计算每个查询词的 IDF
    const idfMap = new Map<string, number>();
    for (const token of queryTokens) {
      const df = this.calculateDocumentFrequency(corpus, token);
      const idf = Math.log((corpus.length - df + 0.5) / (df + 0.5) + 1);
      idfMap.set(token, idf);
    }

    // 4. 计算每个文档的 BM25 分数
    const scores = corpus.map((doc, docIdx) => {
      let score = 0;
      const docLength = docLengths[docIdx];

      for (const token of queryTokens) {
        const tf = this.calculateTermFrequency(doc, token);
        const idf = idfMap.get(token) || 0;

        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));

        score += idf * (numerator / denominator);
      }

      return score;
    });

    return scores;
  }

  dispose() {
    // Jieba 不需要显式释放
  }
}

class RealDocumentBM25Tester {
  private loader: RealDocumentLoader;
  private calculator: BM25Calculator;
  private testQueries: QueryInfo[];

  constructor(docsDir: string) {
    this.loader = new RealDocumentLoader(docsDir);
    this.calculator = new BM25Calculator();
    this.testQueries = this.prepareTestQueries();
  }

  private prepareTestQueries(): QueryInfo[] {
    return [
      {
        name: "知识库相关",
        query: "知识库 向量搜索",
        keywords: ["知识库", "向量", "搜索"],
      },
      {
        name: "BM25 算法",
        query: "BM25 评分 关键词",
        keywords: ["BM25", "评分", "关键词"],
      },
      {
        name: "数据库迁移",
        query: "数据库 迁移 Alembic",
        keywords: ["数据库", "迁移", "Alembic"],
      },
      {
        name: "API 认证",
        query: "JWT 认证 权限",
        keywords: ["JWT", "认证", "权限"],
      },
      {
        name: "性能优化",
        query: "性能优化 缓存",
        keywords: ["性能", "优化", "缓存"],
      },
      {
        name: "混合搜索",
        query: "混合搜索 hybrid search",
        keywords: ["混合", "搜索", "hybrid"],
      },
    ];
  }

  private runQueryTest(queryInfo: QueryInfo, documents: Document[]): QueryResult {
    const query = queryInfo.query;
    const docContents = documents.map(doc => doc.content);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`查询: ${queryInfo.name}`);
    console.log(`查询词: '${query}'`);
    console.log(`文档数量: ${documents.length}`);

    // 分词调试
    const queryTokens = (this.calculator as any).tokenize(query);
    console.log(`查询词分词:`, queryTokens.slice(0, 10).join(', ') + '...');

    // 计算 BM25 分数
    const scores = this.calculator.calculateBM25Scores(query, docContents);

    // 构建结果
    const results: SearchResult[] = [];
    documents.forEach((doc, i) => {
      if (scores[i] > 0) {
        results.push({
          index: i,
          path: doc.path,
          score: scores[i],
          preview: doc.content.substring(0, 100).replace(/\n/g, ' '),
        });
      }
    });

    // 按分数排序
    const sortedResults = results.sort((a, b) => b.score - a.score);

    // 添加排名
    sortedResults.slice(0, 10).forEach((result, rank) => {
      result.rank = rank + 1;
    });

    console.log(`\nTop-10 结果:`);
    sortedResults.slice(0, 10).forEach(result => {
      console.log(`  排名 ${result.rank}: ${result.path}`);
      console.log(`    分数: ${result.score.toFixed(4)}`);
      console.log(`    预览: ${result.preview.substring(0, 80)}...`);
    });

    return {
      query_name: queryInfo.name,
      query: queryInfo.query,
      keywords: queryInfo.keywords,
      total_docs: documents.length,
      matched_docs: sortedResults.length,
      top_results: sortedResults.slice(0, 10),
    };
  }

  runAllTests(maxDocs: number = 20): QueryResult[] {
    console.log('='.repeat(60));
    console.log('真实文档 BM25 对比测试 - TypeScript 端');
    console.log('='.repeat(60));

    // 加载文档
    const documents = this.loader.loadMarkdownFiles(maxDocs);

    if (documents.length === 0) {
      console.error('未找到任何文档');
      return [];
    }

    // 运行每个查询
    const allResults: QueryResult[] = [];
    for (const queryInfo of this.testQueries) {
      const result = this.runQueryTest(queryInfo, documents);
      allResults.push(result);
    }

    // 汇总统计
    console.log(`\n${'='.repeat(60)}`);
    console.log('测试汇总');
    console.log('='.repeat(60));
    console.log(`总查询数: ${allResults.length}`);
    console.log(`总文档数: ${documents.length}`);

    allResults.forEach(result => {
      console.log(`\n查询: ${result.query_name}`);
      console.log(`  匹配文档: ${result.matched_docs}/${result.total_docs}`);
      if (result.top_results.length > 0) {
        console.log(`  Top-1: ${result.top_results[0].path}`);
        console.log(`  Top-1 分数: ${result.top_results[0].score.toFixed(4)}`);
      }
    });

    return allResults;
  }

  exportResults(results: QueryResult[], outputFile: string = 'bm25_real_docs_ts_results.json') {
    const outputPath = path.join(process.cwd(), outputFile);
    
    fs.writeFileSync(outputPath, JSON.stringify({
      test_date: '2026-04-08',
      results: results,
    }, null, 2), 'utf-8');
    
    console.log(`\n测试结果已导出到: ${outputPath}`);
  }

  dispose() {
    this.calculator.dispose();
  }
}

async function main() {
  // 获取 docs 目录路径
  const currentDir = process.cwd();
  const docsDir = path.join(currentDir, '..', 'backend', 'docs');

  const tester = new RealDocumentBM25Tester(docsDir);

  try {
    const results = tester.runAllTests(30);
    tester.exportResults(results);
  } finally {
    tester.dispose();
  }
}

// 执行测试
if (require.main === module) {
  main().catch(console.error);
}

export { RealDocumentLoader, BM25Calculator, RealDocumentBM25Tester };
