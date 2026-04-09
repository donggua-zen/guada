/**
 * BM25 评分对比测试 - TypeScript 端
 * 
 * 与 Python 端的 rank-bm25 进行定量对比分析
 */

import * as fs from 'fs';
import * as path from 'path';
import { Jieba } from '@node-rs/jieba';

interface TestCase {
  name: string;
  query: string;
  documents: string[];
  expected_top_doc_index: number;
}

interface DocumentResult {
  index: number;
  document: string;
  bm25_score: number;
  rank?: number;
}

interface TestResult {
  test_name: string;
  query: string;
  num_documents: number;
  results: DocumentResult[];
  ranking_correct: boolean;
  top_doc_rank: number;
}

interface ComparisonReport {
  test_name: string;
  query: string;
  python_scores: number[];
  ts_scores: number[];
  absolute_errors: number[];
  relative_errors: number[];
  avg_absolute_error: number;
  avg_relative_error: number;
  ranking_consistent: boolean;
  python_top_indices: number[];
  ts_top_indices: number[];
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
      // 中文使用 jieba 分词
      const tokens = this.jieba.cut(text, true);
      // 将英文部分转为小写以保持一致性
      return tokens.map(t => /^[a-zA-Z0-9]+$/.test(t) ? t.toLowerCase() : t);
    } else {
      // 英文按空格分词并转小写
      return text.toLowerCase().split(/\s+/).filter(t => t);
    }
  }

  /**
   * 计算文档频率 (DF)
   */
  private calculateDocumentFrequency(
    corpus: string[][],
    term: string
  ): number {
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
   * 
   * 公式:
   * score(q, d) = Σ IDF(qi) * (TF(qi, d) * (k1 + 1)) / (TF(qi, d) + k1 * (1 - b + b * |d|/avgdl))
   * 
   * @param query 查询文本
   * @param documents 文档列表
   * @param k1 词频饱和参数（默认 1.2）
   * @param b 长度归一化参数（默认 0.75）
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
      // IDF 公式: log((N - df + 0.5) / (df + 0.5) + 1)
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

        // BM25 公式
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
        
        score += idf * (numerator / denominator);
      }

      return score;
    });

    return scores;
  }

  /**
   * 释放资源
   */
  dispose() {
    // Jieba 不需要显式释放
  }
}

class BM25Comparator {
  private calculator: BM25Calculator;
  private testCases: TestCase[];

  constructor() {
    this.calculator = new BM25Calculator();
    this.testCases = this.prepareTestCases();
  }

  private prepareTestCases(): TestCase[] {
    return [
      {
        name: "连字符词汇匹配",
        query: "DV430FBM",
        documents: [
          "这款 DV430FBM-N20 冰箱具有出色的节能性能和大容量存储空间",
          "普通家用冰箱介绍，适合小家庭使用",
          "另一款家电产品，功能齐全",
          "DV430FBM 系列产品的技术规格说明",
          "冰箱维护保养指南",
        ],
        expected_top_doc_index: 0,
      },
      {
        name: "中英文混合搜索",
        query: "冰箱 节能",
        documents: [
          "This is a refrigerator with energy saving features",
          "节能冰箱推荐，省电又环保",
          "空调产品介绍，制冷效果好",
          "冰箱选购指南，关注能效等级",
        ],
        expected_top_doc_index: 1,
      },
      {
        name: "纯英文搜索",
        query: "energy saving refrigerator",
        documents: [
          "Energy saving refrigerator with advanced technology",
          "普通冰箱，无特殊功能",
          "节能型家电产品介绍",
          "Refrigerator maintenance tips and tricks",
        ],
        expected_top_doc_index: 0,
      },
      {
        name: "短查询词",
        query: "DV430",
        documents: [
          "DV430FBM-N20 型号详细说明",
          "DV430 系列产品线介绍",
          "其他型号冰箱对比",
        ],
        expected_top_doc_index: 0,
      },
      {
        name: "长查询词",
        query: "节能大容量冰箱推荐",
        documents: [
          "推荐几款节能大容量的家用冰箱，性价比高",
          "小型冰箱适合单身公寓",
          "冰箱品牌排行榜",
        ],
        expected_top_doc_index: 0,
      },
    ];
  }

  private runTestCase(testCase: TestCase): TestResult {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`测试用例: ${testCase.name}`);
    console.log(`查询词: '${testCase.query}'`);
    console.log(`文档数量: ${testCase.documents.length}`);

    // 分词调试
    console.log(`\n--- 分词结果 ---`);
    const queryTokens = (this.calculator as any).tokenize(testCase.query);
    console.log(`查询词分词:`, queryTokens);
    
    const corpusTokens: string[][] = [];
    testCase.documents.forEach((doc, i) => {
      const tokens = (this.calculator as any).tokenize(doc);
      corpusTokens.push(tokens);
      console.log(`文档 ${i}:`, tokens.length > 10 ? tokens.slice(0, 10).join(', ') + '...' : tokens.join(', '));
    });

    // 计算 BM25 分数
    const scores = this.calculator.calculateBM25Scores(
      testCase.query,
      testCase.documents
    );

    // 构建结果
    const results: DocumentResult[] = testCase.documents.map((doc, i) => ({
      index: i,
      document: doc.length > 50 ? doc.substring(0, 50) + '...' : doc,
      bm25_score: scores[i],
    }));

    // 按分数排序
    const sortedResults = [...results].sort((a, b) => b.bm25_score - a.bm25_score);

    // 添加排名信息
    sortedResults.forEach((result, rank) => {
      result.rank = rank + 1;
    });

    // 检查排名是否符合预期
    const topDocRank = sortedResults.find(
      r => r.index === testCase.expected_top_doc_index
    )?.rank || 0;
    const rankingCorrect = topDocRank === 1;

    console.log(`\n--- BM25 评分结果 ---`);
    sortedResults.forEach(result => {
      console.log(
        `  排名 ${result.rank}: 文档 ${result.index} - ` +
        `分数 ${result.bm25_score.toFixed(4)}`
      );
    });

    console.log(`预期排名第一的文档实际排名: ${topDocRank}`);
    console.log(`排名是否正确: ${rankingCorrect ? '✅' : '❌'}`);

    return {
      test_name: testCase.name,
      query: testCase.query,
      num_documents: testCase.documents.length,
      results: sortedResults,
      ranking_correct: rankingCorrect,
      top_doc_rank: topDocRank,
    };
  }

  runAllTests(): TestResult[] {
    console.log('='.repeat(60));
    console.log('BM25 评分对比测试 - TypeScript 端');
    console.log('='.repeat(60));

    const allResults: TestResult[] = [];
    for (const testCase of this.testCases) {
      const result = this.runTestCase(testCase);
      allResults.push(result);
    }

    // 汇总统计
    const totalTests = allResults.length;
    const correctRankings = allResults.filter(r => r.ranking_correct).length;

    console.log(`\n${'='.repeat(60)}`);
    console.log('测试汇总');
    console.log('='.repeat(60));
    console.log(`总测试数: ${totalTests}`);
    console.log(`排名正确: ${correctRankings}/${totalTests}`);
    console.log(`准确率: ${(correctRankings / totalTests * 100).toFixed(1)}%`);

    return allResults;
  }

  exportResults(results: TestResult[], outputFile: string = 'bm25_ts_results.json') {
    const outputPath = path.join(process.cwd(), outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n测试结果已导出到: ${outputPath}`);
  }

  /**
   * 与 Python 端结果对比
   */
  compareWithPython(
    tsResults: TestResult[],
    pythonResultsPath: string
  ): ComparisonReport[] {
    console.log(`\n${'='.repeat(60)}`);
    console.log('Python vs TypeScript BM25 评分对比');
    console.log('='.repeat(60));

    // 读取 Python 端结果
    const pythonResults: TestResult[] = JSON.parse(
      fs.readFileSync(pythonResultsPath, 'utf-8')
    );

    const reports: ComparisonReport[] = [];

    for (let i = 0; i < tsResults.length; i++) {
      const tsResult = tsResults[i];
      const pyResult = pythonResults[i];

      if (tsResult.test_name !== pyResult.test_name) {
        console.warn(`警告: 测试用例名称不匹配: ${tsResult.test_name} vs ${pyResult.test_name}`);
      }

      // 按文档索引对齐分数
      const tsScoreMap = new Map(tsResult.results.map(r => [r.index, r.bm25_score]));
      const pyScoreMap = new Map(pyResult.results.map(r => [r.index, r.bm25_score]));

      const docIndices = Array.from(tsScoreMap.keys());
      
      const pythonScores: number[] = [];
      const tsScores: number[] = [];
      const absoluteErrors: number[] = [];
      const relativeErrors: number[] = [];

      for (const idx of docIndices) {
        const pyScore = pyScoreMap.get(idx) || 0;
        const tsScore = tsScoreMap.get(idx) || 0;

        pythonScores.push(pyScore);
        tsScores.push(tsScore);

        const absError = Math.abs(pyScore - tsScore);
        const relError = pyScore !== 0 ? absError / Math.abs(pyScore) : 0;

        absoluteErrors.push(absError);
        relativeErrors.push(relError);
      }

      const avgAbsError = absoluteErrors.reduce((sum, e) => sum + e, 0) / absoluteErrors.length;
      const avgRelError = relativeErrors.reduce((sum, e) => sum + e, 0) / relativeErrors.length;

      // 检查排名一致性
      const pyTopIndices = pyResult.results.map(r => r.index);
      const tsTopIndices = tsResult.results.map(r => r.index);
      const rankingConsistent = JSON.stringify(pyTopIndices) === JSON.stringify(tsTopIndices);

      const report: ComparisonReport = {
        test_name: tsResult.test_name,
        query: tsResult.query,
        python_scores: pythonScores,
        ts_scores: tsScores,
        absolute_errors: absoluteErrors,
        relative_errors: relativeErrors,
        avg_absolute_error: avgAbsError,
        avg_relative_error: avgRelError,
        ranking_consistent: rankingConsistent,
        python_top_indices: pyTopIndices,
        ts_top_indices: tsTopIndices,
      };

      reports.push(report);

      // 打印对比结果
      console.log(`\n测试用例: ${tsResult.test_name}`);
      console.log(`查询词: '${tsResult.query}'`);
      console.log(`平均绝对误差: ${avgAbsError.toFixed(6)}`);
      console.log(`平均相对误差: ${(avgRelError * 100).toFixed(2)}%`);
      console.log(`排名一致性: ${rankingConsistent ? '✅' : '❌'}`);
      
      console.log('\n详细对比:');
      console.log('文档ID | Python分数 | TS分数   | 绝对误差  | 相对误差');
      console.log('-------|------------|----------|-----------|----------');
      for (let j = 0; j < docIndices.length; j++) {
        console.log(
          `${String(docIndices[j]).padEnd(6)} | ` +
          `${pythonScores[j].toFixed(6).padEnd(10)} | ` +
          `${tsScores[j].toFixed(6).padEnd(8)} | ` +
          `${absoluteErrors[j].toFixed(6).padEnd(9)} | ` +
          `${(relativeErrors[j] * 100).toFixed(2).padEnd(6)}%`
        );
      }
    }

    // 总体统计
    const totalAvgAbsError = reports.reduce((sum, r) => sum + r.avg_absolute_error, 0) / reports.length;
    const totalAvgRelError = reports.reduce((sum, r) => sum + r.avg_relative_error, 0) / reports.length;
    const consistentCount = reports.filter(r => r.ranking_consistent).length;

    console.log(`\n${'='.repeat(60)}`);
    console.log('总体统计');
    console.log('='.repeat(60));
    console.log(`平均绝对误差: ${totalAvgAbsError.toFixed(6)}`);
    console.log(`平均相对误差: ${(totalAvgRelError * 100).toFixed(2)}%`);
    console.log(`排名一致性: ${consistentCount}/${reports.length} (${(consistentCount / reports.length * 100).toFixed(1)}%)`);

    return reports;
  }

  exportComparisonReport(reports: ComparisonReport[], outputFile: string = 'bm25_comparison_report.json') {
    const outputPath = path.join(process.cwd(), outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(reports, null, 2), 'utf-8');
    console.log(`\n对比报告已导出到: ${outputPath}`);
  }

  dispose() {
    this.calculator.dispose();
  }
}

async function main() {
  const comparator = new BM25Comparator();

  try {
    // 1. 运行 TS 端测试
    const tsResults = comparator.runAllTests();
    comparator.exportResults(tsResults);

    // 2. 与 Python 端结果对比（如果存在）
    const pythonResultsPath = path.join(
      process.cwd(),
      '..',
      'backend',
      'tests',
      'verification',
      'bm25_python_results.json'
    );

    if (fs.existsSync(pythonResultsPath)) {
      const comparisonReports = comparator.compareWithPython(tsResults, pythonResultsPath);
      comparator.exportComparisonReport(comparisonReports);
    } else {
      console.log('\n未找到 Python 端测试结果，跳过对比分析');
      console.log('请先运行: python backend/tests/verification/test_bm25_diff.py');
    }
  } finally {
    comparator.dispose();
  }
}

// 执行测试
if (require.main === module) {
  main().catch(console.error);
}

export { BM25Calculator, BM25Comparator };
