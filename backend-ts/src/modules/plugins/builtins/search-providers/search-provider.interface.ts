export interface SearchResult {
  index?: number;
  title: string;
  link: string;
  score: string;
  date?: string;
  summary?: string;
  content?: string;
}

export interface SearchResponse {
  total: number;
  results: SearchResult[];
  note?: string;
}

export interface ParseResponse {
  title?: string;
  url: string;
  date?: string;
  summary?: string;
  content?: string;
}

export interface SearchOptions {
  size?: number;
}

/** 供应商能力声明 */
export interface SearchCapabilities {
  /** 搜索是否支持范围筛选 */
  scope?: {
    supported: boolean;
    values?: string[];
  };
  /** 搜索结果中是否可带回原文 */
  searchReturnsContent: boolean;
  /** 是否支持独立的网页内容提取 */
  supportsWebpageExtract: boolean;
  /** score 字段类型 */
  scoreType: "string" | "number";
}

export interface SearchProvider {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: SearchCapabilities;
  search(
    q: string,
    options: SearchOptions,
    apiKey: string,
  ): Promise<SearchResponse>;
  readWebpage(
    url: string,
    format: string,
    apiKey: string,
  ): Promise<ParseResponse | string>;
}
