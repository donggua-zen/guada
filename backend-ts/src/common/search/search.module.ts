/**
 * 搜索模块
 *
 * 管理独立的搜索索引数据库（FTS5），与主业务库隔离。
 * SearchIndexService 对外暴露搜索能力，SearchSyncService 内部驱动同步。
 */

import { Module, Global } from "@nestjs/common";
import { SearchIndexService } from "./search-index.service";
import { SearchSyncService } from "./search-sync.service";

@Global()
@Module({
  providers: [SearchIndexService, SearchSyncService],
  exports: [SearchIndexService],
})
export class SearchModule {}
