/**
 * 搜索模块
 *
 * 会话内容搜索（JSONL 实时批扫描）：无索引库、无同步 worker，
 * SessionContentSearchService 按批扫描 JSONL 折叠后实时匹配。
 */

import { Module, Global } from "@nestjs/common";
import { SessionContentSearchService } from "./session-content-search.service";

@Global()
@Module({
  providers: [SessionContentSearchService],
  exports: [SessionContentSearchService],
})
export class SearchModule {}
